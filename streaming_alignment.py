"""Shared bounded native Rhubarb region recognizer. Importing starts no work."""
import json
import math
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time
import wave

class Cancelled(Exception):
    pass

def process_tree_rss(pid):
    result = subprocess.run(['ps', '-axo', 'pid=,ppid=,rss='], capture_output=True,
                            text=True, check=True, timeout=3)
    rows = [tuple(map(int, line.split())) for line in result.stdout.splitlines()]
    children = {pid}
    while True:
        expanded = children | {child for child, parent, rss in rows if parent in children}
        if children == expanded:
            break
        children = expanded
    return sum(rss * 1024 for child, parent, rss in rows if child in children)


def trim_cues(cues, region, rate):
    output = []
    duration = (region['inputEnd'] - region['inputStart']) / rate
    previous = 0
    for cue in cues:
        if (not isinstance(cue, dict) or not isinstance(cue.get('value'), str)
                or len(cue['value']) != 1 or cue['value'] not in 'ABCDEFGHX'
                or not all(isinstance(cue.get(k), (int, float)) and math.isfinite(cue[k]) for k in ('start', 'end'))
                or cue['start'] < previous or cue['end'] < cue['start'] or cue['end'] > duration + .05):
            raise ValueError('Invalid Rhubarb mouth cues')
        previous = cue['end']
        a = max(region['start'], region['inputStart'] + round(cue['start'] * rate))
        b = min(region['end'], region['inputStart'] + round(cue['end'] * rate))
        if b > a:
            output.append({'start': a / rate, 'end': b / rate, 'value': cue['value']})
    return output


def kill_group(child):
    try:
        os.killpg(child.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass
    child.wait()


def recognize(binary, source, region, cancelled, active=None, timeout=15, memory_mib=384, rss_monitor=process_tree_rss):
    """No cache. Every region invokes real Rhubarb with a finalized private WAV."""
    if cancelled.is_set():
        raise Cancelled()
    started, peak = time.perf_counter(), 0
    with tempfile.TemporaryDirectory(prefix='asena-stream-region-') as folder:
        folder = Path(folder)
        audio, dialog = folder/'input.wav', folder/'dialog.txt'
        with wave.open(str(audio), 'wb') as wav:
            wav.setparams((1, 2, source['rate'], 0, 'NONE', 'NONE'))
            wav.writeframes(source['pcm'][region['inputStart']*2:region['inputEnd']*2])
        dialog.write_text(' '.join(s['word'] for s in source['timestamps']
                                  if s['start_time'] < region['inputEnd']/source['rate']
                                  and s['end_time'] > region['inputStart']/source['rate']))
        with (folder/'out').open('w') as out, (folder/'err').open('w') as err:
            child = subprocess.Popen([str(binary), '-f', 'json', '-q', '-r', 'pocketSphinx',
                                      '--threads', '1', '-d', str(dialog), str(audio)],
                                     stdout=out, stderr=err, start_new_session=True,
                                     env=dict(os.environ, OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1'))
            if active:
                active(child.pid)
            try:
                while child.poll() is None:
                    if cancelled.wait(.05):
                        raise Cancelled()
                    if time.perf_counter() - started > timeout:
                        raise RuntimeError('Rhubarb region exceeded its 15-second deadline')
                    rss = rss_monitor(child.pid)
                    peak = max(peak, rss)
                    if peak > memory_mib * 1024**2:
                        raise RuntimeError('Rhubarb exceeded the 384 MiB process-tree budget')
                if child.returncode:
                    raise RuntimeError('Rhubarb failed: ' + (folder/'err').read_text()[-1000:])
                cues = trim_cues(json.loads((folder/'out').read_text())['mouthCues'], region, source['rate'])
            finally:
                if child.poll() is None:
                    kill_group(child)
                if active:
                    active(None)
    return {'cues': cues, 'seconds': time.perf_counter()-started, 'peakRssBytes': peak}
