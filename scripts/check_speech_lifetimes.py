#!/usr/bin/env python3
"""Bounded repeated-turn check with captured PCM; never runs Kokoro or an LLM."""
import argparse
import gc
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import kokoro_stream
from streaming_alignment import recognize, trim_cues


class CapturedResponse:
    status_code=200
    def __init__(self, body):self.body=body;self.closed=False
    def __enter__(self):return self
    def __exit__(self,*args):self.closed=True
    def iter_content(self,size):
        for offset in range(0,len(self.body),size):yield self.body[offset:offset+size]


def mocked_recognizer(binary,source,region,cancelled,active):
    return {'cues':trim_cues([{'start':0,'end':len(source['pcm'])/2/source['rate'],'value':'X'}],region,source['rate']),
            'seconds':0,'peakRssBytes':0}


def rss():
    return int(subprocess.check_output(['ps','-p',str(os.getpid()),'-o','rss='],text=True,timeout=3).strip())*1024


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--turns',type=int,default=30)
    parser.add_argument('--native',action='store_true',help='Analyze saved audio with one native Rhubarb child at a time')
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if not 1<=args.turns<=50:parser.error('Choose 1–50 turns')
    packets=json.loads((ROOT/'docs/evidence/kokoro-live-protocol-short-2026-10-12.json').read_text())
    body=b''.join(json.dumps(packet).encode()+b'\n' for packet in packets)
    expected=hashlib.sha256(b''.join(kokoro_stream.decode_pcm(packet) for packet in packets)).hexdigest()
    before=rss();rows=[]
    with tempfile.TemporaryDirectory(prefix='asena-lifetimes-') as temporary,patch.object(kokoro_stream,'ROOT',Path(temporary)):
        registry=kokoro_stream.StreamRegistry()
        for index in range(args.turns):
            response=CapturedResponse(body)
            owner=registry.reserve({'input':kokoro_stream.TRIAL_TEXTS['short'],'voice':'af_heart','strategy':'whole'},
                post=lambda *a,**k:response,recognizer=recognize if args.native else mocked_recognizer)
            count=0;report=None;started=time.monotonic()
            for event in owner.iterate():
                if event['type']=='segment':
                    count+=1;owner.progress(event['endFrame'])
                if event['type']=='result':report=event['report']
                if event['type']=='error':raise RuntimeError(event['error'])
            owner.worker.join(1);registry.release(owner)
            assert report and report['complete'] and report['sourceSha256']==expected
            assert registry.active is None and response.closed
            assert not owner.worker.is_alive() and not owner.producer.is_alive()
            assert not owner.pcm and not owner.words and not owner.protocol and owner.queue.empty()
            rows.append({'turn':index+1,'seconds':time.monotonic()-started,'regions':count,
                         'rhubarbPeakRssBytes':report['peakRssBytes'],'parentRssBytes':rss(),
                         'incomingPeakSeconds':report['incomingPeakSeconds'],'preparedPeakSeconds':report['preparedPeakSeconds'],
                         'remainingWorkers':0,'remainingPcmBytes':0,'registryReleased':True})
            del owner,response,report;gc.collect()
    result={'fixtureOnly':True,'nativeRhubarb':args.native,'synthesis':False,'llm':False,
            'measurement':'Captured PCM, immediate sample acknowledgements; not audible playback or end-to-end latency.',
            'profile':kokoro_stream.SPEECH_PROFILE,'strategyOverride':'whole for this fixed captured packet',
            'parentRssBeforeBytes':before,'parentRssAfterBytes':rss(),'turns':rows,
            'limitations':'Small serial regression only; combined LLM/TTS capacity and browser heap need a prepared live session.'}
    args.output.parent.mkdir(parents=True,exist_ok=True)
    args.output.write_text(json.dumps(result,indent=2)+'\n')
    print(f'{args.turns} captured turns passed; no retained workers, PCM queues or stream owners.')


if __name__=='__main__':main()
