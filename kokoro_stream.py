"""Explicitly requested Kokoro PCM streaming with bounded Rhubarb lookahead.

Importing this module never contacts a provider or starts a process.
"""
import base64
import binascii
import codecs
import fcntl
import hashlib
import http.client
import json
from pathlib import Path
import queue
import secrets
import socket
import threading
import time
from urllib.parse import urlsplit

from config import ROOT, RHUBARB, KOKORO_API
from service_contracts import ServiceError, require_payload, normalize_timestamps
from streaming_alignment import Cancelled, recognize

RATE = 24000
MAX_LINE = 2_000_000
MAX_AUDIO_SECONDS = 180
DEADLINE = 180


class HttpStream:
    """HTTP streaming with an owned socket that cancellation can interrupt.

    Closing a response file from another thread can wait on its read lock.
    Shutdown the owned socket instead, then let the reader close its resources.
    """
    def __init__(self, endpoint, payload, cancelled):
        parsed=urlsplit(endpoint)
        cls=http.client.HTTPSConnection if parsed.scheme=='https' else http.client.HTTPConnection
        self.connection=cls(parsed.hostname,parsed.port,timeout=3)
        self.path=(parsed.path or '/')+('?' + parsed.query if parsed.query else '')
        self.payload=payload;self.cancelled=cancelled;self.socket=None;self.response=None
    def cancel(self):
        if self.socket:
            try:self.socket.shutdown(socket.SHUT_RDWR)
            except OSError:pass
    def __enter__(self):
        try:
            self.connection.connect();self.socket=self.connection.sock;self.socket.settimeout(15)
            if self.cancelled.is_set():raise Cancelled()
            self.connection.request('POST',self.path,json.dumps(self.payload).encode(),{'Content-Type':'application/json'})
            self.response=self.connection.getresponse();self.status_code=self.response.status
            return self
        except Exception:
            self.connection.close();raise
    def __exit__(self,*_):
        if self.response:self.response.close()
        self.connection.close()
    def iter_content(self,size):
        while True:
            chunk=self.response.read1(size)
            if not chunk:break
            yield chunk


class JsonLines:
    def __init__(self):
        self.decoder = codecs.getincrementaldecoder('utf-8')('strict')
        self.pending = ''

    def push(self, chunk, final=False):
        self.pending += self.decoder.decode(chunk, final=final)
        parts = self.pending.split('\n'); self.pending = parts.pop()
        if len(self.pending) > MAX_LINE or any(len(p) > MAX_LINE for p in parts):
            raise ValueError('Oversized Kokoro stream frame')
        if final and self.pending.strip():
            raise ValueError('Truncated Kokoro stream frame')
        values = [json.loads(p) for p in parts if p.strip()]
        if any(not isinstance(value, dict) for value in values):
            raise ValueError('Expected Kokoro stream objects')
        return values


def speech_payload(data):
    if not isinstance(data, dict) or set(data)-{'input', 'voice', 'speed', 'policy', 'startupSeconds'}:
        raise ServiceError('Expected speech text, voice and streaming buffer options.', 400)
    payload = require_payload({k: v for k, v in data.items() if k in ('input', 'voice', 'speed')}, 'tts')
    policy, startup = data.get('policy', '2s'), data.get('startupSeconds', 2)
    if policy not in ('1s', '2s', '3s') or type(startup) is not int or startup not in (2, 4):
        raise ServiceError('Choose 1–3 second regions and a 2 or 4 second startup buffer.', 400)
    return {**payload, 'stream': True, 'response_format': 'pcm', 'return_timestamps': True}, policy, startup


def decode_packet(value, previous_start=0):
    if value.get('audio_format') != 'audio/pcm' or not isinstance(value.get('audio'), str):
        raise ValueError('Expected Kokoro mono PCM16 at 24 kHz (audio/pcm)')
    try:
        pcm = base64.b64decode(value['audio'], validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError('Invalid Kokoro PCM encoding') from error
    if not pcm or len(pcm) % 2 or len(pcm) > 30 * RATE * 2:
        raise ValueError('Empty, partial-sample or oversized Kokoro PCM frame')
    words = normalize_timestamps(value.get('timestamps', []))
    if any(len(w['word'])>256 for w in words):raise ValueError('Oversized Kokoro timestamp token')
    if words and words[0]['start_time'] < previous_start:
        raise ValueError('Kokoro word timestamps moved backwards')
    return pcm, words


class SpeechStream:
    def __init__(self, data, *, endpoint=KOKORO_API, post=None, recognizer=recognize,
                 binary=RHUBARB, capture=False):
        self.payload, self.policy, self.startup = speech_payload(data)
        self.endpoint, self.post, self.recognizer, self.binary = endpoint, post, recognizer, binary
        self.token = secrets.token_hex(16)
        self.cancelled = threading.Event(); self.condition = threading.Condition()
        self.queue = queue.Queue(maxsize=12)
        self.started = 0; self.pcm = bytearray(); self.base = self.frames = self.played = self.emitted = 0
        self.words = []; self.done = False; self.failure = None; self.child_pid = None
        self.events = []; self.arrivals = []; self.digest = hashlib.sha256()
        self.capture = capture; self.protocol = []
        self.incoming_peak = self.prepared_peak = 0; self.provider_finished = None
        self.first_packet = None; self.producer = None; self.worker = None
        self.transport = None
        self.last_word_start = 0; self.word_count = 0

    def cancel(self):
        self.cancelled.set()
        if self.transport:self.transport.cancel()
        with self.condition: self.condition.notify_all()

    def check(self):
        if self.cancelled.is_set(): raise Cancelled()
        if self.failure: raise self.failure
        if time.monotonic()-self.started > DEADLINE:
            raise RuntimeError('Streaming speech exceeded its three-minute deadline')

    def progress(self, frame):
        with self.condition:
            if type(frame) is not int or not self.played <= frame <= self.emitted:
                raise ValueError('Playback acknowledgement is outside emitted audio')
            self.played = frame; self.condition.notify_all()

    def wait(self, predicate):
        with self.condition:
            while not predicate():
                self.check(); self.condition.wait(.05)
            self.check()

    def event(self, value):
        value = dict(value, token=self.token, wallSeconds=time.monotonic()-self.started)
        # PCM is transient. Diagnostics contain timings and hashes, not private speech audio.
        self.events.append({k: v for k, v in value.items() if k not in ('pcm', 'report')})
        while True:
            self.check()
            try: self.queue.put(value, timeout=.05); return
            except queue.Full: pass

    def ingest(self, value):
        pcm, words = decode_packet(value, self.last_word_start)
        self.word_count += len(words)
        if len(self.arrivals) >= 512 or self.word_count > 20000:
            raise ValueError('Kokoro stream exceeded its packet or word limit')
        if words: self.last_word_start = words[-1]['start_time']
        if self.frames + len(pcm)//2 > MAX_AUDIO_SECONDS*RATE:
            raise ValueError('Speech exceeds the three-minute audio limit')
        end_seconds = (self.frames + len(pcm)//2)/RATE
        if any(w['end_time'] > end_seconds+.1 for w in words):
            raise ValueError('Kokoro timestamps exceed the received audio timeline')
        arrival = {'index': len(self.arrivals), 'wallSeconds': time.monotonic()-self.started,
                   'startFrame': self.frames, 'frames': len(pcm)//2, 'wordCount': len(words)}
        self.first_packet = self.first_packet if self.first_packet is not None else arrival['wallSeconds']
        self.arrivals.append(arrival)
        if self.capture: self.protocol.append(value)
        self.digest.update(pcm)
        # A decoded provider packet can itself contain up to 30 seconds. Append in
        # bounded pieces, preserving its original arrival time in diagnostics.
        with self.condition: self.words.extend(words)
        if words: self.event({'type':'words', 'timestamps':words})
        for offset in range(0, len(pcm), RATE//10*2):
            piece = pcm[offset:offset+RATE//10*2]
            self.wait(lambda: self.frames-self.base+len(piece)//2 <= 16*RATE)
            with self.condition:
                self.pcm.extend(piece); self.frames += len(piece)//2
                self.incoming_peak = max(self.incoming_peak, self.frames-self.base)
                self.condition.notify_all()

    def produce(self):
        try:
            if self.post: response_context=self.post(self.endpoint, json=self.payload, stream=True, timeout=(3,15))
            else:
                self.transport=HttpStream(self.endpoint,self.payload,self.cancelled)
                response_context=self.transport
            with response_context as response:
                if response.status_code != 200:
                    raise RuntimeError(f'Kokoro returned HTTP {response.status_code}')
                parser = JsonLines()
                for chunk in response.iter_content(4096):
                    self.check()
                    for value in parser.push(chunk): self.ingest(value)
                for value in parser.push(b'', final=True): self.ingest(value)
            if not self.frames: raise ValueError('Kokoro returned no speech audio')
            with self.condition:
                self.done = True; self.provider_finished = time.monotonic()-self.started
                self.condition.notify_all()
        except Cancelled: pass
        except Exception as error:
            if not self.cancelled.is_set():
                with self.condition:self.failure = error;self.condition.notify_all()

    def report(self, complete):
        segments = [e for e in self.events if e['type'] == 'segment']
        return {'fixtureOnly': False, 'provider': 'Kokoro captioned PCM', 'rate': RATE,
                'policy': self.policy, 'startupSeconds': self.startup, 'complete': complete,
                'duration': self.frames/RATE, 'sourceSha256': self.digest.hexdigest(),
                'firstProviderAudioSeconds': self.first_packet, 'providerFinishedSeconds': self.provider_finished,
                'providerPackets': self.arrivals, 'analysisSeconds': sum(e['seconds'] for e in segments),
                'peakRssBytes': max([0]+[e['peakRssBytes'] for e in segments]),
                'incomingPeakSeconds': self.incoming_peak/RATE, 'preparedPeakSeconds': self.prepared_peak/RATE,
                'limits': {'incomingSeconds':16, 'preparedSeconds':12, 'decodedPacketSeconds':30,
                           'audioSeconds':MAX_AUDIO_SECONDS, 'deadlineSeconds':DEADLINE, 'providerReadTimeoutSeconds':15},
                'events': self.events[:]}

    def work(self):
        self.started = time.monotonic(); complete = False
        folder = ROOT/'.runtime/stream-probe'; folder.mkdir(parents=True, exist_ok=True)
        lock=None
        try:
            lock=(folder/'active.lock').open('a')
            try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error: raise RuntimeError('Another Rhubarb stream is running') from error
            self.event({'type':'begin', 'rate':RATE, 'startupSeconds':self.startup,
                        'source':'live Kokoro', 'cache':False, 'threads':1})
            self.producer = threading.Thread(target=self.produce, daemon=True); self.producer.start()
            hop, context, start, index = int(self.policy[0])*RATE, RATE//4, 0, 0
            while True:
                self.wait(lambda: self.done or self.frames >= start+hop+context)
                with self.condition:
                    if self.done and start == self.frames: break
                    end = min(start+hop, self.frames)
                    left, right = max(0, start-context), min(self.frames, end+context)
                self.wait(lambda: end-self.played <= 12*RATE)
                with self.condition:
                    audio = bytes(self.pcm[(left-self.base)*2:(right-self.base)*2])
                    stamps = [{**w, 'start_time':max(0,w['start_time']-left/RATE),
                               'end_time':max(0,w['end_time']-left/RATE)} for w in self.words
                              if w['start_time'] < right/RATE and w['end_time'] > left/RATE]
                local = {'start':start-left, 'end':end-left, 'inputStart':0, 'inputEnd':right-left}
                self.event({'type':'analysis', 'index':index, 'region':{'start':start, 'end':end,
                            'inputStart':left, 'inputEnd':right}})
                result = self.recognizer(self.binary, {'rate':RATE, 'pcm':audio, 'timestamps':stamps},
                                         local, self.cancelled, lambda pid:setattr(self,'child_pid',pid))
                self.check()
                cues = [{**c, 'start':c['start']+left/RATE, 'end':c['end']+left/RATE} for c in result['cues']]
                retained = audio[(start-left)*2:(end-left)*2]
                with self.condition:
                    self.emitted = end; keep = max(0,end-context)
                    del self.pcm[:(keep-self.base)*2]; self.base = keep
                    self.words = [w for w in self.words if w['end_time'] > keep/RATE]
                    self.prepared_peak = max(self.prepared_peak, self.emitted-self.played)
                    self.condition.notify_all()
                self.event({'type':'segment', 'index':index, 'startFrame':start, 'endFrame':end,
                            **result, 'cues':cues, 'pcm':base64.b64encode(retained).decode(),
                            'pcmSha256':hashlib.sha256(retained).hexdigest(), 'timestamps':[
                                {**w,'start_time':w['start_time']+left/RATE,'end_time':w['end_time']+left/RATE} for w in stamps]})
                start, index = end, index+1
            self.event({'type':'eos'}); self.wait(lambda:self.played == self.frames)
            complete = True
            self.event({'type':'result', 'report':self.report(True)})
        except Cancelled:
            pass
        except Exception as error:
            # Do not expose provider response bodies or paths to the browser.
            try:
                message = str(error) if isinstance(error,(ValueError,RuntimeError)) else 'Kokoro stream unavailable or interrupted. Retry when ready.'
                self.failure = None; self.event({'type':'error', 'error':message})
            except Cancelled: pass
        finally:
            self.cancel()
            if self.producer: self.producer.join(timeout=16)
            if lock:lock.close()
            self.complete = complete

    def iterate(self):
        self.worker = threading.Thread(target=self.work, daemon=True); self.worker.start()
        try:
            while self.worker.is_alive() or not self.queue.empty():
                try: value = self.queue.get(timeout=.5)
                except queue.Empty:
                    if not self.worker.is_alive(): break
                    yield {'type':'heartbeat', 'token':self.token}; continue
                yield value
        finally:
            self.cancel()


class StreamRegistry:
    def __init__(self): self.lock = threading.Lock(); self.active = None
    def reserve(self, data, **options):
        stream = SpeechStream(data, **options)
        with self.lock:
            if self.active is not None: raise ServiceError('Streaming speech is busy. Wait for it to finish.', 409)
            self.active = stream
        return stream
    def release(self, stream):
        # Retain ownership until both alignment and provider-reader threads exit.
        def finish():
            if stream.worker: stream.worker.join()
            with self.lock:
                if self.active is stream: self.active = None
        if stream.worker and stream.worker.is_alive():threading.Thread(target=finish, daemon=True).start()
        else:finish()
    def control(self, data, cancel=False):
        with self.lock:
            stream = self.active
            if not isinstance(data, dict) or not stream or data.get('token') != stream.token:
                raise ServiceError('No matching speech stream.', 409)
            if cancel: stream.cancel()
            else: stream.progress(data.get('playedFrames'))
        return {'ok':True}

TRIAL_TEXTS = {
    'short': "Hi, I'm Asena. It's lovely to meet you. Tell me a little about yourself.",
    'sustained': "Hi, I'm Asena. It's lovely to meet you. Tell me a little about yourself. "
        "I like a conversation with a little warmth, a little wit, and room for disagreement. "
        "If you tell me something important, I want to remember it accurately. "
        "Now let's keep talking while the next part of my voice gets ready. "
        "A short pause is fine, but a smooth conversation feels much more natural. "
        "That is why we are checking the voice and the mouth movement together."
}
