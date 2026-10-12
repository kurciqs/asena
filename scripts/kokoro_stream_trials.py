"""Explicit live Kokoro trials. Never starts Docker or a provider automatically."""
import argparse
import json
from pathlib import Path
import sys
import threading
import time

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from kokoro_stream import SpeechStream, TRIAL_TEXTS, RATE
from config import ROOT


def trial(label, startup, endpoint, capture=False, strategy='whole', opening=2):
    stream=SpeechStream({'input':TRIAL_TEXTS[label],'voice':'af_heart','policy':'2s','startupSeconds':startup,
                        'strategy':strategy,'openingSeconds':opening},
                        endpoint=endpoint,capture=capture)
    done=threading.Event();lock=threading.Lock();ready=0;eos=False;first=None;played=0.;last=None;gap=None;gaps=[]
    def tick():
        nonlocal first,played,last,gap
        while not done.wait(.01):
            now=time.monotonic()
            with lock:
                if first is None and (ready>=startup*RATE or eos and ready):first=now-stream.started;last=now
                if first is None:continue
                requested=(now-last)*RATE;last=now;available=max(0,ready-played)
                played=float(ready) if available<=requested else played+requested;stream.progress(int(played))
                if available<requested and not(eos and played>=ready):
                    if gap is None:gap=now
                elif gap is not None:gaps.append({'seconds':now-gap});gap=None
    sink=threading.Thread(target=tick,daemon=True);sink.start();result=None
    try:
        for event in stream.iterate():
            if event['type']=='segment':
                with lock:ready=event['endFrame']
            elif event['type']=='eos':
                with lock:eos=True
            elif event['type']=='error':raise RuntimeError(event['error'])
            elif event['type']=='result':result=event['report']
        if result is None:raise RuntimeError('Trial ended without a report')
        result['receiver']={'kind':'wall-clock sink; no audible playback','firstPlaybackSeconds':first,
                            'gaps':gaps,'gapSeconds':sum(g['seconds'] for g in gaps),'playedFrames':int(played)}
        return result,stream.protocol
    finally:
        done.set();stream.cancel();sink.join(timeout=1)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--endpoint',default='http://127.0.0.1:8881/dev/captioned_speech')
    parser.add_argument('--output',type=Path,default=ROOT/'docs/evidence/kokoro-live-stream-trials-2026-10-12.json')
    parser.add_argument('--case',choices=('matrix','short','sustained'),default='matrix')
    parser.add_argument('--startup',type=float,choices=(.5,1,2,4),default=2)
    parser.add_argument('--strategy',choices=('whole','phrases'),default='whole')
    parser.add_argument('--opening',type=float,choices=(.5,1,2),default=2)
    args=parser.parse_args()
    if args.endpoint not in ('http://127.0.0.1:8881/dev/captioned_speech','http://127.0.0.1:8880/dev/captioned_speech'):
        parser.error('Only the deliberately configured loopback Kokoro service is supported')
    results=[]
    cases=[('short',2),('sustained',2),('sustained',4)] if args.case=='matrix' else [(args.case,args.startup)]
    for label,startup in cases:
        print(f'Running {label}, {startup}s startup reserve',flush=True)
        result,protocol=trial(label,startup,args.endpoint,capture=label=='short' and args.strategy=='whole',strategy=args.strategy,opening=args.opening);results.append(result)
        args.output.parent.mkdir(parents=True,exist_ok=True)
        args.output.write_text(json.dumps({'liveProvider':True,'llmCalled':False,'runs':results},indent=2)+'\n')
        if protocol:(args.output.parent/(args.output.stem+'-protocol.json')).write_text(json.dumps(protocol)+'\n')
        print(json.dumps({k:result[k] for k in ('duration','firstProviderAudioSeconds','providerFinishedSeconds','analysisSeconds','peakRssBytes','receiver')}),flush=True)


if __name__=='__main__':main()
