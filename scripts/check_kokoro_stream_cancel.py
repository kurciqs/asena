"""Explicit live cancellation trial against the already-started local Kokoro."""
import json
from pathlib import Path
import subprocess
import sys
import time

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from kokoro_stream import SpeechStream,TRIAL_TEXTS
from config import ROOT

stream=SpeechStream({'input':TRIAL_TEXTS['sustained'],'voice':'af_heart'},
                    endpoint='http://127.0.0.1:8881/dev/captioned_speech')
events=[];pid=None;started=None
try:
    iterator=stream.iterate()
    for event in iterator:
        events.append({k:v for k,v in event.items() if k!='pcm'})
        if event['type']=='error':raise RuntimeError(event['error'])
        if event['type']=='analysis':
            deadline=time.monotonic()+2
            while not stream.child_pid and time.monotonic()<deadline:time.sleep(.01)
            pid=stream.child_pid
            if not pid:raise RuntimeError('No active native alignment process was observed')
            time.sleep(.1);started=time.monotonic();stream.cancel();break
    if started is None:raise RuntimeError('No analysis region arrived')
    iterator.close();stream.worker.join(timeout=3)
    elapsed=time.monotonic()-started
    if stream.worker.is_alive() or stream.producer.is_alive():raise RuntimeError('Cancellation left a speech worker running')
    process=subprocess.run(['ps','-p',str(pid),'-o','pid='],capture_output=True,text=True,timeout=2)
    if process.stdout.strip():raise RuntimeError('Rhubarb child survived cancellation')
    result={'liveProvider':True,'llmCalled':False,'cancelToWorkerExitSeconds':elapsed,
            'cancelAtSeconds':started-stream.started,'nativePid':pid,'childGone':True,
            'providerReaderGone':True,'queuedEventsAfterCancel':[e['type'] for e in list(stream.queue.queue)],
            'providerPacketsReceived':stream.arrivals,'eventsBeforeCancel':events}
    path=ROOT/'docs/evidence/kokoro-stream-cancel-2026-10-12.json'
    path.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)
finally:
    stream.cancel()
