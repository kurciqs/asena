"""Offline lip-sync audition. Uses saved WAVs; never calls TTS or an LLM.

Default: export recorded controls and raw PCM for the lightweight Node detectors.
--spectra: NumPy FFT inputs emulating Web Audio for the frequency detectors.
--batches: serial one-thread Rhubarb on bounded overlapping windows.
--lam: isolated, one-thread ONNX CPU probe, killed above 600 MiB RSS / 60 s.
All model weights and intermediates stay in ignored .runtime/lip-sync-lab.
"""
import argparse
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import subprocess
import sys
import time
import wave

ROOT = Path(__file__).resolve().parents[1]
PUBLIC = ROOT / 'src/lip-sync-lab'
WORK = ROOT / '.runtime/lip-sync-lab'


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, ensure_ascii=False, separators=(',', ':')) + '\n')


def prepare():
    fixture = json.loads((ROOT / 'src/replay/benchmark.json').read_text())
    cases = []
    for key, turn in zip(['intro', 'teasing', 'disagreement'], fixture['turns'][:3]):
        audio = ROOT / 'src' / turn['speech']['audio'].lstrip('/')
        with wave.open(str(audio)) as wav:
            assert wav.getnchannels() == 1 and wav.getsampwidth() == 2
            pcm = wav.readframes(wav.getnframes())
            rate = wav.getframerate()
        (WORK / (key + '.pcm')).write_bytes(pcm)
        cases.append({'id': key, 'label': turn['label'], 'audio': turn['speech']['audio'],
                      'duration': len(pcm) / 2 / rate, 'sampleRate': rate,
                      'text': turn['speech']['spokenText'], 'timestamps': turn['speech']['timestamps'],
                      'rhubarb': turn['visemes'], 'audioSha256': hashlib.sha256(audio.read_bytes()).hexdigest()})
    save(WORK / 'inputs.json', cases)
    return cases


def batches(cases):
    tool = ROOT.parent / 'rhubarb/rhubarb'
    output = {}
    for case in cases:
        data = (WORK / (case['id'] + '.pcm')).read_bytes()
        rate, duration = case['sampleRate'], case['duration']
        cues, measurements = [], []
        for index in range(math.ceil(duration)):
            start, end = max(0, index - .25), min(duration, index + 1.25)
            first, last = round(start * rate), round(end * rate)
            chunk = WORK / 'rhubarb-window.wav'
            with wave.open(str(chunk), 'wb') as wav:
                wav.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
                wav.writeframes(data[first * 2:last * 2])
            dialog = ' '.join(stamp['word'] for stamp in case['timestamps']
                              if stamp['start_time'] < end and stamp['end_time'] > start)
            (WORK / 'window-dialog.txt').write_text(dialog)
            before = time.perf_counter()
            result = subprocess.run([str(tool), '--threads', '1', '-q', '-f', 'json',
                                     '-d', str(WORK / 'window-dialog.txt'), str(chunk)],
                                    capture_output=True, text=True, timeout=30, check=True)
            elapsed = time.perf_counter() - before
            measurements.append({'window': index, 'inputStart': start, 'inputEnd': end, 'seconds': elapsed})
            for cue in json.loads(result.stdout)['mouthCues']:
                left = max(index, start + cue['start'])
                right = min(index + 1, duration, start + cue['end'])
                if right > left:
                    cues.append({'start': left, 'end': right, 'value': cue['value']})
            print(case['id'], 'window', index, round(elapsed, 2), 'seconds', flush=True)
        output[case['id']] = {'cues': cues, 'measurements': measurements,
                              'windowSeconds': 1.5, 'hopSeconds': 1, 'contextSeconds': .25,
                              'threads': 1, 'recognizer': 'pocketSphinx'}
    save(WORK / 'rhubarb-batches.json', output)


def spectra(cases):
    import numpy as np
    for case in cases:
        audio = np.frombuffer((WORK / (case['id'] + '.pcm')).read_bytes(), dtype='<i2').astype(np.float64) / 32768
        rate, result = case['sampleRate'], {}
        for size, smoothing in [(2048, .8), (256, .5)]:
            previous, rows = np.zeros(size // 2), []
            n = np.arange(size)
            window = .42 - .5 * np.cos(2 * np.pi * n / size) + .08 * np.cos(4 * np.pi * n / size)
            for index in range(math.ceil(case['duration'] * 60) + 1):
                end = min(len(audio), round(index * rate / 60))
                block = audio[max(0, end - size):end]
                block = np.pad(block, (size - len(block), 0))
                magnitude = np.abs(np.fft.rfft(block * window)[:size // 2]) / size
                previous = smoothing * previous + (1 - smoothing) * magnitude
                db = 20 * np.log10(np.maximum(previous, 1e-12))
                byte = np.clip(np.floor((db + 100) / 70 * 255), 0, 255).astype(int)
                td = np.clip(np.floor(128 * (block + 1)), 0, 255).astype(int)
                rows.append({'frequency': byte.tolist(), 'timeDomain': td.tolist()})
            result[str(size)] = rows
        save(WORK / (case['id'] + '-spectra.json'), result)


def lam_worker():
    import numpy as np
    import onnxruntime as ort
    import resource
    options = ort.SessionOptions()
    options.intra_op_num_threads = 1
    options.inter_op_num_threads = 1
    options.graph_optimization_level = ort.GraphOptimizationLevel.ORT_DISABLE_ALL
    options.enable_mem_pattern = False
    options.enable_cpu_mem_arena = False
    before = time.perf_counter()
    session = ort.InferenceSession(str(WORK / 'lam_ios.onnx'), sess_options=options,
                                   providers=['CPUExecutionProvider'])
    print('Loaded ONNX', ort.__version__, 'in', round(time.perf_counter() - before, 2), 's', flush=True)
    inputs = session.get_inputs()
    print('Inputs', [(i.name, i.shape, i.type) for i in inputs], flush=True)
    print('Outputs', [(i.name, i.shape, i.type) for i in session.get_outputs()], flush=True)
    provenance = json.loads((WORK / 'lam-provenance.json').read_text())
    output = {'provenance': provenance, 'onnxruntime': ort.__version__, 'threads': 1,
              'windowSeconds': 1, 'hopSeconds': .5, 'cases': {}}
    for case in json.loads((WORK / 'inputs.json').read_text()):
        decoded = subprocess.run(['ffmpeg', '-v', 'error', '-threads', '1', '-filter_threads', '1',
                                  '-i', str(ROOT / 'src' / case['audio'].lstrip('/')), '-ac', '1',
                                  '-ar', '16000', '-f', 'f32le', 'pipe:1'],
                                 capture_output=True, check=True, timeout=10).stdout
        audio = np.frombuffer(decoded, dtype='<f4')
        count = math.ceil(case['duration'] * 30) + 1
        totals, weights = np.zeros((count, 52)), np.zeros(count)
        timings = []
        for start in np.arange(0, case['duration'], .5):
            chunk = audio[round(start * 16000):round((start + 1) * 16000)]
            chunk = np.pad(chunk, (0, 16000 - len(chunk)))
            feed = {}
            for inp in inputs:
                dtype = np.float16 if inp.type == 'tensor(float16)' else np.float32
                if len(inp.shape) == 2 and inp.shape[-1] == 12:
                    identity = np.zeros((1, 12), dtype=dtype)
                    identity[0, 0] = 1
                    feed[inp.name] = identity
                else:
                    feed[inp.name] = chunk.reshape(1, -1).astype(dtype)
            before = time.perf_counter()
            values = session.run(None, feed)
            elapsed = time.perf_counter() - before
            matches = [v for v in values if v.ndim == 3 and v.shape[-1] == 52]
            if len(matches) != 1:
                raise RuntimeError('Could not identify the 52-channel output')
            frame = matches[0][0].astype(np.float32)
            if frame.shape[0] != 30 or not np.isfinite(frame).all():
                raise RuntimeError('Unexpected frame count or non-finite neural output')
            # Only overlap one-second windows of this fixed-input model; no stateful-streaming claim.
            for i, values in enumerate(frame):
                index = round(start * 30) + i
                if index >= count:
                    continue
                weight = min(1, (i + 1) / 8, (30 - i) / 8)
                totals[index] += values * weight
                weights[index] += weight
            timings.append(elapsed)
        valid = weights > 0
        totals[valid] /= weights[valid, None]
        if not valid[-1] and valid[-2]:
            totals[-1] = totals[-2]
        output['cases'][case['id']] = {'fps': 30, 'frames': np.round(totals, 5).tolist(),
                                     'windowSeconds': timings}
        print(case['id'], len(timings), 'neural windows prepared', flush=True)
    output['peakRssBytes'] = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    save(WORK / 'lam-results.json', output)


def guarded_lam():
    environment = dict(os.environ, OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1', VECLIB_MAXIMUM_THREADS='1')
    log = WORK / 'lam-probe.log'
    start, peak, reason = time.monotonic(), 0, None
    with log.open('w') as stream:
        child = subprocess.Popen([sys.executable, __file__, '--lam-worker'], env=environment,
                                 stdout=stream, stderr=subprocess.STDOUT)
        try:
            while child.poll() is None:
                rss = subprocess.run(['ps', '-o', 'rss=', '-p', str(child.pid)], capture_output=True,
                                     text=True, timeout=2, check=True).stdout.strip()
                if rss:
                    peak = max(peak, int(rss) * 1024)
                elif child.poll() is None:
                    reason = 'Memory guard unavailable: no RSS for running worker'
                if peak > 600 * 1024 ** 2:
                    reason = 'Stopped at 600 MiB RSS guard'
                elif time.monotonic() - start > 60:
                    reason = 'Stopped at 60 second deadline'
                if reason:
                    child.kill()
                    break
                time.sleep(.2)
            child.wait(timeout=5)
        except (OSError, ValueError, subprocess.SubprocessError) as error:
            reason = f'Memory guard unavailable: {type(error).__name__}: {error}'
            child.kill()
            child.wait(timeout=5)
        finally:
            if child.poll() is None:
                child.kill()
                child.wait()
    result = {'returncode': child.returncode, 'peakObservedRssBytes': peak,
              'seconds': time.monotonic() - start, 'reason': reason}
    save(WORK / 'lam-probe.json', result)
    print(json.dumps(result))
    print(log.read_text()[-2400:])


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--batches', action='store_true')
    parser.add_argument('--spectra', action='store_true')
    parser.add_argument('--lam', action='store_true')
    parser.add_argument('--lam-worker', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    WORK.mkdir(parents=True, exist_ok=True)
    if args.lam_worker:
        lam_worker()
    elif args.lam:
        guarded_lam()
    else:
        cases = prepare()
        if args.spectra:
            spectra(cases)
        if args.batches:
            batches(cases)
