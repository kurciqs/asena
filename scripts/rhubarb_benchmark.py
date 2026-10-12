"""Bounded Rhubarb experiments on synthetic saved Kokoro recordings only.

No TTS, LLM or Docker calls. One experiment at a time; a process-tree RSS guard
and deadline stop the complete child group. Run with permission to inspect its
own processes. Results and build products live in ignored .runtime/.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import wave

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / '.runtime/rhubarb-optimization'


def save(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2) + '\n')


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


def guarded_run(command, *, name, timeout=60, memory_mib=768, cwd=ROOT):
    WORK.mkdir(parents=True, exist_ok=True)
    out, err = WORK / (name + '.stdout'), WORK / (name + '.stderr')
    peak, reason = 0, None
    environment = dict(os.environ, OMP_NUM_THREADS='1', OPENBLAS_NUM_THREADS='1',
                       VECLIB_MAXIMUM_THREADS='1')
    with out.open('w') as stdout, err.open('w') as stderr:
        start = time.perf_counter()
        child = subprocess.Popen(command, stdout=stdout, stderr=stderr, cwd=cwd,
                                 start_new_session=True, env=environment)
        try:
            next_sample = 0
            while child.poll() is None:
                elapsed = time.perf_counter() - start
                if elapsed >= next_sample:
                    rss = process_tree_rss(child.pid)
                    if rss == 0 and child.poll() is None:
                        raise RuntimeError('No process RSS available for running child')
                    peak = max(peak, rss)
                    next_sample = elapsed + .1
                if peak > memory_mib * 1024 ** 2:
                    raise RuntimeError(f'Exceeded {memory_mib} MiB process-tree RSS budget')
                if elapsed > timeout:
                    raise RuntimeError(f'Exceeded {timeout} second deadline')
                time.sleep(.01)
            child.wait()
        except BaseException as error:
            reason = str(error)
            try:
                os.killpg(child.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            child.wait()
            if isinstance(error, (KeyboardInterrupt, SystemExit)):
                raise
        finally:
            if child.poll() is None:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
    result = {'seconds': time.perf_counter() - start, 'peakRssBytes': peak,
              'returncode': child.returncode, 'guardError': reason,
              'stdout': str(out.relative_to(ROOT)), 'stderr': str(err.relative_to(ROOT))}
    save(WORK/(name+'-guard.json'),result)
    if reason or child.returncode:
        raise RuntimeError(json.dumps(result) + '\n' + err.read_text()[-2000:])
    return result


def clips():
    benchmark = json.loads((ROOT / 'src/replay/benchmark.json').read_text())
    entries = list(benchmark['turns']) + [benchmark['recall'], benchmark['recall']['withoutMemory']]
    result = []
    for turn in entries:
        speech = turn.get('speech', {})
        if not speech.get('audio'):
            continue
        audio = ROOT / 'src' / speech['audio'].lstrip('/')
        if any(c['audio'] == str(audio) for c in result):
            continue
        with wave.open(str(audio)) as wav:
            duration = wav.getnframes() / wav.getframerate()
        result.append({'id': audio.stem, 'audio': str(audio),
                       'text': speech['spokenText'], 'duration': duration,
                       'timestamps': speech.get('timestamps',[]),
                       'sha256': hashlib.sha256(audio.read_bytes()).hexdigest(),
                       'reference': turn.get('visemes', [])})
    save(WORK / 'clips.json', result)
    return result


def align(binary, clip, *, name, threads=1, dialog=True, recognizer='pocketSphinx',
          extra=(), audio=None):
    dialogue = WORK / (clip['id'] + '-dialog.txt')
    dialogue.write_text(clip['text'])
    command = [str(binary), '-f', 'json', '-q', '--threads', str(threads),
               '-r', recognizer, *extra]
    if dialog:
        command += ['-d', str(dialogue)]
    command += [audio or clip['audio']]
    measurement = guarded_run(command, name=name)
    output = json.loads((ROOT / measurement['stdout']).read_text())
    cues = output['mouthCues']
    measurement.update({'id': name, 'clip': clip['id'], 'duration': clip['duration'],
                        'threads': threads, 'dialog': dialog, 'recognizer': recognizer,
                        'rtf': measurement['seconds'] / clip['duration'], 'cues': cues})
    return measurement


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='mode', required=True)
    guard = sub.add_parser('guard')
    guard.add_argument('--name', required=True)
    guard.add_argument('--timeout', type=int, default=600)
    guard.add_argument('--memory-mib', type=int, default=768)
    guard.add_argument('command', nargs=argparse.REMAINDER)
    sub.add_parser('prepare')
    matrix = sub.add_parser('matrix')
    matrix.add_argument('--binary', type=Path, required=True)
    matrix.add_argument('--label', required=True)
    matrix.add_argument('--threads', type=int, nargs='+', default=[1])
    matrix.add_argument('--repeats', type=int, default=1)
    matrix.add_argument('--no-dialog', action='store_true')
    matrix.add_argument('--recognizer', default='pocketSphinx')
    matrix.add_argument('--clip', nargs='*')
    args = parser.parse_args()
    if args.mode == 'guard':
        command = args.command[1:] if args.command[:1] == ['--'] else args.command
        result = guarded_run(command, name=args.name, timeout=args.timeout,
                             memory_mib=args.memory_mib)
        save(WORK / (args.name + '-guard.json'), result)
        print(json.dumps(result), flush=True)
    elif args.mode == 'prepare':
        print([(c['id'], round(c['duration'], 3)) for c in clips()])
    else:
        inputs = clips()
        result_file = WORK / (args.label + '-results.json')
        output = json.loads(result_file.read_text()) if result_file.exists() else []
        completed = {value['id'] for value in output}
        for repeat in range(args.repeats):
            for threads in args.threads:
                for clip in inputs:
                    if args.clip and clip['id'] not in args.clip:
                        continue
                    name = f'{args.label}-{clip["id"]}-t{threads}-r{repeat}'
                    if name in completed:
                        continue
                    value = align(args.binary.resolve(), clip, name=name,
                                  threads=threads, dialog=not args.no_dialog,
                                  recognizer=args.recognizer)
                    output.append(value)
                    save(WORK / (args.label + '-results.json'), output)
                    print(name, round(value['seconds'], 3), 's',
                          round(value['peakRssBytes'] / 1024 ** 2, 1), 'MiB', flush=True)


if __name__ == '__main__':
    main()
