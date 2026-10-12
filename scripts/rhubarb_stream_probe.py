"""Paced Rhubarb probe with optional, explicitly enabled live Kokoro trials.

CLI uses a measured wall-clock receiver (no audible output); --serve enables a
separate loopback test page with actual Web Audio playback and cancellation.
Default CLI/server modes use saved audio only; imports never contact providers.
"""
import argparse
import base64
import fcntl
import hashlib
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import math
import os
from pathlib import Path
import re
import secrets
import signal
import sys
import threading
import time
import wave

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from config import default_rhubarb
from streaming_alignment import Cancelled, trim_cues, recognize as recognize_region
from kokoro_stream import StreamRegistry, TRIAL_TEXTS
from service_contracts import ServiceError
from rhubarb_benchmark import clips, process_tree_rss

RATE = 44100
POLICIES = ('1s', '2s', '3s', 'sentences')
PROFILES = ('steady1x', 'steady2x', 'bursty1x', 'bufferingDemo')


def dataset(repeats=1):
    """Fixed synthetic fixtures only; integer sample clock, no new speech."""
    pcm, stamps, provenance, offset = [], [], [], 0
    inputs = clips()
    for _ in range(repeats):
        for clip in inputs:
            with wave.open(clip['audio']) as wav:
                if (wav.getframerate(), wav.getnchannels(), wav.getsampwidth()) != (RATE, 1, 2):
                    raise ValueError('Probe requires saved mono PCM16 44.1 kHz fixtures')
                data = wav.readframes(wav.getnframes())
            for stamp in clip['timestamps']:
                stamps.append(dict(stamp, start_time=stamp['start_time'] + offset / RATE,
                                   end_time=stamp['end_time'] + offset / RATE))
            provenance.append({'id': clip['id'], 'sha256': clip['sha256'], 'startFrame': offset})
            pause = b'\0\0' * round(.35 * RATE)
            pcm.extend((data, pause)); offset += len(data) // 2 + len(pause) // 2
    data = b''.join(pcm)
    return {'pcm': data, 'frames': offset, 'rate': RATE, 'timestamps': stamps,
            'fixtures': provenance, 'sha256': hashlib.sha256(data).hexdigest()}


def regions(source, policy, context=.25):
    total, rate = source['frames'], source['rate']
    if policy not in POLICIES:
        raise ValueError('Unknown analysis policy')
    if policy == 'sentences':
        cuts = [0]
        stamps = source['timestamps']
        for left, right in zip(stamps, stamps[1:]):
            if re.search(r'[.!?]["\u201d\u2019]?$', left['word']):
                cut = round((left['end_time'] + right['start_time']) * rate / 2)
                if cuts[-1] < cut < total:
                    cuts.append(cut)
        cuts.append(total)
        # Bound long punctuation-free speech too; this is an analysis cap only.
        bounded = [0]
        for cut in cuts[1:]:
            while cut - bounded[-1] > 5 * rate:
                bounded.append(bounded[-1] + 5 * rate)
            bounded.append(cut)
        cuts = bounded
    else:
        hop = int(policy[0]) * rate
        cuts = list(range(0, total, hop)) + [total]
    overlap = round(context * rate)
    return [{'start': a, 'end': b, 'inputStart': max(0, a-overlap),
             'inputEnd': min(total, b+overlap)} for a, b in zip(cuts, cuts[1:])]


def delivery_schedule(source, profile):
    if profile not in PROFILES:
        raise ValueError('Unknown arrival profile')
    total, rate = source['frames'], source['rate']
    hop = round((.75 if profile == 'bursty1x' else .1) * rate)
    result = []
    previous_due = 0
    for end in list(range(hop, total, hop)) + [total]:
        due = end / rate / (2 if profile == 'steady2x' else 1)
        if profile == 'bufferingDemo' and end / rate >= 10:
            # Hold the incoming stream for eight seconds, then resume at 1x.
            # This deliberately drains the startup buffer; it is not a Kokoro measurement.
            due += 8
        if profile == 'bursty1x':
            # Deliberate two-second delivery stall, then catch-up bursts.
            if 10 <= end / rate < 12:
                due += 2
            due = max(previous_due, due)
        result.append((end, due)); previous_due = due
    return result


def recognize(binary, source, region, cancelled, active=None, timeout=15, memory_mib=384):
    return recognize_region(binary, source, region, cancelled, active, timeout, memory_mib,
                            rss_monitor=process_tree_rss)


class Probe:
    """Paced producer + serial recognizer + bounded prepared/incoming queues."""
    def __init__(self, source, policy='2s', profile='steady1x', startup=2, emit=lambda e: None,
                 binary=None, recognizer=recognize):
        if policy not in POLICIES or profile not in PROFILES or startup not in (2, 4):
            raise ValueError('Invalid probe configuration')
        self.source, self.policy, self.profile, self.startup = source, policy, profile, startup
        self.binary = binary or default_rhubarb()
        self.recognizer, self.emit = recognizer, emit
        self.cancelled = threading.Event(); self.condition = threading.Condition()
        self.available = self.released = self.emitted = self.played = 0
        self.max_incoming, self.max_prepared = 16*source['rate'], 12*source['rate']
        self.incoming_peak = self.prepared_peak = self.child_pid = 0
        self.started = 0; self.events = []; self.blocked = 0

    def event(self, value):
        value = dict(value, wallSeconds=time.perf_counter()-self.started)
        self.events.append({k: v for k, v in value.items() if k != 'pcm'})
        self.emit(value)

    def cancel(self):
        self.cancelled.set()
        with self.condition:
            self.condition.notify_all()

    def progress(self, frame):
        with self.condition:
            if not isinstance(frame, int) or not self.played <= frame <= self.emitted:
                raise ValueError('Playback acknowledgement is outside emitted audio')
            self.played = frame; self.condition.notify_all()

    def wait_until(self, predicate):
        with self.condition:
            while not predicate():
                if self.cancelled.is_set():
                    raise Cancelled()
                if self.started and time.perf_counter()-self.started > self.source['frames']/self.source['rate']+60:
                    raise RuntimeError('Saved-audio test exceeded its total deadline')
                self.condition.wait(.05)
            if self.cancelled.is_set():
                raise Cancelled()

    def produce(self):
        try:
            for end, due in delivery_schedule(self.source, self.profile):
                if self.cancelled.wait(max(0, self.started+due-time.perf_counter())):
                    return
                before = time.perf_counter()
                self.wait_until(lambda: end-self.released <= self.max_incoming)
                self.blocked += time.perf_counter()-before
                with self.condition:
                    self.available = end
                    self.incoming_peak = max(self.incoming_peak, end-self.released)
                    self.condition.notify_all()
        except Cancelled:
            pass

    def run(self):
        if self.recognizer is not recognize:
            return self._run()
        folder=ROOT/'.runtime/stream-probe';folder.mkdir(parents=True, exist_ok=True)
        # Share the single-recognizer limit across CLI and browser test processes.
        with (folder/'active.lock').open('a') as lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error:
                raise RuntimeError('Another saved-audio probe is running; wait for it to finish') from error
            try:
                return self._run()
            finally:
                fcntl.flock(lock, fcntl.LOCK_UN)

    def _run(self):
        self.started = time.perf_counter()
        source = self.source
        self.event({'type': 'begin', 'policy': self.policy, 'profile': self.profile,
                    'startupSeconds': self.startup, 'duration': source['frames']/source['rate'],
                    'rate': source['rate'], 'frames': source['frames'], 'sha256': source['sha256'],
                    'cache': False, 'threads': 1, 'incomingLimitSeconds': 16, 'preparedLimitSeconds': 12})
        producer = threading.Thread(target=self.produce, daemon=True); producer.start()
        complete = False
        try:
            for index, region in enumerate(regions(source, self.policy)):
                self.wait_until(lambda: self.available >= region['inputEnd']
                                and region['end']-self.played <= self.max_prepared)
                def active(pid):
                    self.child_pid = pid or 0
                self.event({'type': 'analysis', 'index': index, 'region': region})
                value = self.recognizer(self.binary, source, region, self.cancelled, active)
                if self.cancelled.is_set():
                    raise Cancelled()
                with self.condition:
                    self.emitted = region['end']
                    self.released = max(0, region['end']-round(.25*source['rate']))
                    self.prepared_peak = max(self.prepared_peak, self.emitted-self.played)
                    self.condition.notify_all()
                self.event({'type': 'segment', 'index': index, 'startFrame': region['start'],
                            'endFrame': region['end'], 'region': region, **value,
                            'pcm': base64.b64encode(source['pcm'][region['start']*2:region['end']*2]).decode(),
                            'pcmSha256': hashlib.sha256(source['pcm'][region['start']*2:region['end']*2]).hexdigest(),
                            'incomingSeconds': (self.available-self.released)/source['rate'],
                            'preparedSeconds': (self.emitted-self.played)/source['rate']})
            complete = True
            self.event({'type': 'eos'})
            self.wait_until(lambda: self.played >= source['frames'])
            self.event({'type': 'complete'})
        except Cancelled:
            self.event({'type': 'cancelled', 'emittedFrames': self.emitted, 'playedFrames': self.played})
        finally:
            self.cancel(); producer.join(timeout=2)
        segments = [e for e in self.events if e['type'] == 'segment']
        return {'fixtureOnly': True, 'policy': self.policy, 'profile': self.profile,
                'startupSeconds': self.startup, 'duration': source['frames']/source['rate'],
                'sourceSha256': source['sha256'], 'fixtures': source['fixtures'],
                'binarySha256': hashlib.sha256(Path(self.binary).read_bytes()).hexdigest() if self.recognizer is recognize else 'test-double',
                'complete': complete and self.played >= source['frames'], 'cache': False,
                'analysisSeconds': sum(e['seconds'] for e in segments),
                'peakRssBytes': max([0]+[e['peakRssBytes'] for e in segments]),
                'incomingPeakSeconds': self.incoming_peak/source['rate'],
                'preparedPeakSeconds': self.prepared_peak/source['rate'],
                'deliveryBackpressureSeconds': self.blocked, 'events': self.events}


class ClockReceiver:
    """Wall-clock playback accounting for CLI. No sound device/browser claim."""
    def __init__(self, probe):
        self.probe = probe; self.ready = 0; self.eos = False; self.played = 0.0
        self.first = None; self.gap_start = None; self.gaps = []; self.done = threading.Event()
        self.lock = threading.Lock(); self.peak_buffer = 0; self.min_buffer = None

    def accept(self, event):
        with self.lock:
            if event['type'] == 'segment':
                self.ready = event['endFrame']
            if event['type'] == 'eos':
                self.eos = True

    def tick(self):
        previous = time.perf_counter()
        while not self.done.wait(.01):
            now = time.perf_counter()
            with self.lock:
                if self.first is None and (self.ready >= self.probe.startup*self.probe.source['rate']
                                            or self.eos):
                    self.first = now-self.probe.started; previous = now
                if self.first is not None:
                    requested = (now-previous)*self.probe.source['rate']
                    available = self.ready-self.played
                    consumed = min(requested, available)
                    self.played += consumed
                    gap = requested-consumed
                    if gap > .001 and not (self.eos and self.played >= self.ready):
                        if self.gap_start is None:
                            self.gap_start = now-gap/self.probe.source['rate']
                    elif self.gap_start is not None:
                        self.gaps.append({'start': self.gap_start-self.probe.started,
                                          'seconds': now-self.gap_start})
                        self.gap_start = None
                    buffer = (self.ready-self.played)/self.probe.source['rate']
                    self.peak_buffer = max(self.peak_buffer, buffer)
                    self.min_buffer = buffer if self.min_buffer is None else min(self.min_buffer, buffer)
                    self.probe.progress(min(self.ready, math.floor(self.played)))
                    if self.eos and self.played >= self.ready:
                        return
            previous = now

    def metrics(self):
        return {'receiver': 'measured wall-clock sink; no browser/audio-device playback',
                'firstPlaybackSeconds': self.first, 'gaps': self.gaps,
                'gapSeconds': sum(g['seconds'] for g in self.gaps),
                'bufferPeakSeconds': self.peak_buffer, 'bufferMinimumSeconds': self.min_buffer,
                'playedFrames': math.floor(self.played)}


def cli_run(policy, profile, startup, repeats):
    probe = Probe(dataset(repeats), policy, profile, startup)
    receiver = ClockReceiver(probe); probe.emit = receiver.accept
    thread = threading.Thread(target=receiver.tick, daemon=True); thread.start()
    try:
        result = probe.run(); result['receiver'] = receiver.metrics()
    finally:
        receiver.done.set(); thread.join(timeout=2)
    return result


class ProbeServer(ThreadingHTTPServer):
    daemon_threads = True
    def __init__(self, port, allow_kokoro=False):
        super().__init__(('127.0.0.1', port), Handler)
        self.active_lock = threading.Lock(); self.active = None
        self.live = StreamRegistry(); self.allow_kokoro = allow_kokoro


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *_):
        pass

    def allowed(self):
        hosts = {f'localhost:{self.server.server_port}', f'127.0.0.1:{self.server.server_port}'}
        if self.headers.get('Host') not in hosts:
            return False
        origin = self.headers.get('Origin')
        return (not origin or origin == 'http://'+self.headers['Host']) and self.headers.get('Sec-Fetch-Site') != 'cross-site'

    def answer(self, status, value):
        data = json.dumps(value).encode()
        self.send_response(status); self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(data))); self.send_header('Cache-Control', 'no-store')
        self.end_headers(); self.wfile.write(data)

    def do_GET(self):
        if not self.allowed():
            return self.answer(403, {'error': 'Local same-origin test page only'})
        if self.path == '/probe/health':
            return self.answer(200, {'fixtureOnly': not self.server.allow_kokoro, 'liveEnabled':self.server.allow_kokoro,
                                    'trialTexts':TRIAL_TEXTS,
                                    'running': bool(self.server.active or self.server.live.active)})
        path = self.path.split('?', 1)[0]
        allowed = (path in ('/', '/stream-test.html', '/lip-sync-lab/lab.css',
                           '/lip-sync-lab/mouth-adapters.js', '/load_mixamo_animation.js',
                           '/mixamo_vrm_rig_map.js', '/pcm_stream_playback.js', '/rhubarb_mouth.js',
                           '/vrm_models/asena_sfw.vrm', '/animations/idle.fbx')
                   or path in ('/stream-lab/client.js', '/stream-lab/playback.js',
                               '/stream-lab/viewer.js', '/stream-lab/style.css','/stream-lab/startup-timing.js'))
        if not allowed:
            return self.answer(404, {'error': 'Not a probe asset'})
        asset = ROOT/'src'/('stream-test.html' if path == '/' else path.lstrip('/'))
        if not asset.is_file():
            return self.answer(404, {'error': 'Missing local probe asset'})
        types = {'.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript', '.vrm': 'model/gltf-binary'}
        data = asset.read_bytes()
        self.send_response(200); self.send_header('Content-Type', types.get(asset.suffix, 'application/octet-stream'))
        self.send_header('Content-Length', str(len(data))); self.send_header('Cache-Control', 'no-store')
        self.end_headers(); self.wfile.write(data)

    def do_POST(self):
        if not self.allowed():
            return self.answer(403, {'error': 'Local same-origin test page only'})
        try:
            size = int(self.headers.get('Content-Length', 0))
            if not 0 < size < 2048:
                raise ValueError('Invalid request size')
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError('Expected an object')
            if self.path.startswith('/probe/live'):
                if not self.server.allow_kokoro:
                    return self.answer(403, {'error':'Live Kokoro trials are disabled'})
                if self.path in ('/probe/live/progress', '/probe/live/cancel'):
                    return self.answer(200, self.server.live.control(data, cancel=self.path.endswith('cancel')))
                if self.path != '/probe/live' or not {'policy','startupSeconds','repeats'}<=set(data) or set(data)-{'policy','startupSeconds','repeats','strategy','openingSeconds'}:
                    raise ValueError('Unknown live trial request')
                if type(data['repeats']) is not int or data['repeats'] not in (1,3):
                    raise ValueError('Choose the fixed short or sustained trial')
                if self.server.active:
                    return self.answer(409, {'error':'A saved-audio test is running'})
                stream = self.server.live.reserve({'input':TRIAL_TEXTS['short' if data['repeats']==1 else 'sustained'],
                    'voice':'af_heart', 'policy':data['policy'], 'startupSeconds':data['startupSeconds'],
                    'strategy':data.get('strategy','whole'),'openingSeconds':data.get('openingSeconds',2)})
                self.send_response(200); self.send_header('Content-Type','application/x-ndjson')
                self.send_header('Cache-Control','no-store'); self.end_headers()
                try:
                    for event in stream.iterate():
                        self.wfile.write((json.dumps(event,separators=(',',':'))+'\n').encode()); self.wfile.flush()
                except (BrokenPipeError, ConnectionResetError): pass
                finally:
                    stream.cancel(); self.server.live.release(stream)
                return
            if self.path in ('/probe/cancel', '/probe/progress'):
                with self.server.active_lock:
                    active = self.server.active
                    if not active or data.get('token') != active['token']:
                        return self.answer(409, {'error': 'No matching test run'})
                    if self.path.endswith('cancel'):
                        active['probe'].cancel()
                    else:
                        active['probe'].progress(data.get('playedFrames'))
                return self.answer(200, {'ok': True})
            if self.path != '/probe/run' or set(data) != {'policy', 'profile', 'startupSeconds', 'repeats'}:
                raise ValueError('Unknown test request')
            if type(data['repeats']) is not int or data['repeats'] not in (1, 3):
                raise ValueError('Only the fixed short/long fixture is supported')
            probe = Probe(dataset(data['repeats']), data['policy'], data['profile'], data['startupSeconds'])
        except ServiceError as error:
            return self.answer(error.status, {'error':str(error)})
        except (ValueError, KeyError, TypeError) as error:
            return self.answer(400, {'error': str(error)})
        token = secrets.token_hex(16)
        with self.server.active_lock:
            if self.server.active or self.server.live.active:
                return self.answer(409, {'error': 'Another saved-audio test is running'})
            self.server.active = {'token': token, 'probe': probe}
        self.send_response(200); self.send_header('Content-Type', 'application/x-ndjson')
        self.send_header('Cache-Control', 'no-store'); self.end_headers()
        def emit(event):
            self.wfile.write((json.dumps(dict(event, token=token), separators=(',', ':'))+'\n').encode())
            self.wfile.flush()
        probe.emit = emit
        try:
            result = probe.run()
            emit({'type': 'result', 'report': result})
        except (BrokenPipeError, ConnectionResetError):
            probe.cancel()
        except Exception as error:
            probe.cancel()
            try:
                emit({'type': 'error', 'error': str(error)})
            except OSError:
                pass
        finally:
            probe.cancel()
            with self.server.active_lock:
                self.server.active = None


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serve', action='store_true'); parser.add_argument('--port', type=int, default=3002)
    parser.add_argument('--allow-kokoro', action='store_true', help='Enable explicit live trial requests; starts no provider on its own')
    parser.add_argument('--matrix', action='store_true'); parser.add_argument('--output', type=Path,
                        default=ROOT/'docs/evidence/rhubarb-stream-probe-2026-10-12.json')
    parser.add_argument('--policy', choices=POLICIES, default='2s')
    parser.add_argument('--profile', choices=PROFILES, default='steady1x')
    parser.add_argument('--startup', type=int, choices=(2, 4), default=2)
    parser.add_argument('--repeats', type=int, choices=(1, 3), default=1)
    args = parser.parse_args()
    if args.serve:
        server = ProbeServer(args.port, allow_kokoro=args.allow_kokoro)
        print(f'{"Saved audio + explicit live trials" if args.allow_kokoro else "Saved-audio test only"}: http://localhost:{args.port}/stream-test.html', flush=True)
        try:
            server.serve_forever()
        finally:
            if server.live.active: server.live.active.cancel()
            if server.active:
                active=server.active['probe'];active.cancel()
                deadline=time.monotonic()+2
                while server.active and time.monotonic()<deadline:
                    time.sleep(.05)
                if active.child_pid:
                    try:
                        os.killpg(active.child_pid,signal.SIGKILL)
                    except ProcessLookupError:
                        pass
            server.server_close()
        return
    configurations = [(args.policy, args.profile, args.startup, args.repeats)]
    if args.matrix:
        configurations = [(p, 'steady1x', 2, 1) for p in POLICIES]
        configurations += [('2s', p, 4, 3) for p in PROFILES if p != 'bufferingDemo']
    results = []
    args.output.parent.mkdir(parents=True, exist_ok=True)
    for config in configurations:
        print('Running', config, flush=True)
        value = cli_run(*config); results.append(value)
        args.output.write_text(json.dumps({'fixtureOnly': True, 'runs': results}, indent=2)+'\n')
        print(json.dumps({k: value[k] for k in ('policy', 'profile', 'startupSeconds', 'duration', 'analysisSeconds', 'peakRssBytes', 'receiver')}), flush=True)


if __name__ == '__main__':
    main()
