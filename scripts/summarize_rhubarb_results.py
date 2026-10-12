"""Publish reproducible synthetic-fixture Rhubarb timings, never personal audio."""
import json
import math
from pathlib import Path
import statistics
from rhubarb_benchmark import ROOT, WORK, clips, save
from run_rhubarb_strategy_suite import agreement


def simulate(windows, arrival_rate):
    finish=0
    ready=[]
    for window in windows:
        finish=max(finish,window['inputEnd']/arrival_rate)+window['seconds']
        ready.append({'retainedStart':window['retainedStart'],'readyAt':finish})
    # At least this initial delay is required to play every region continuously.
    buffer=max(r['readyAt']-r['retainedStart'] for r in ready)
    return {'assumedArrivalAudioSecondsPerSecond':arrival_rate,'firstRegionReadyAt':ready[0]['readyAt'],
            'minimumContinuousStartAt':buffer,'readiness':ready,
            'note':'Synthetic arrival model; excludes Kokoro first-chunk latency and shared CPU contention.'}


def main():
    inputs=clips()
    matrix={name:json.loads((WORK/(name+'-results.json')).read_text())
            for name in ['intel-dialog','native-dialog','native-m3','native-no-dialog',
                         'native-phonetic','resample','original-24k','composite','window','streaming-policy']
            if (WORK/(name+'-results.json')).exists()}
    summary=[]
    for c in inputs:
        native=[r for r in matrix['native-dialog'] if r['clip']==c['id'] and r['threads']==1]
        intel=[r for r in matrix['intel-dialog'] if r['clip']==c['id']]
        seconds=statistics.mean(r['seconds'] for r in native)
        summary.append({'clip':c['id'],'duration':c['duration'],'audioSha256':c['sha256'],
                        'intelMeanSeconds':statistics.mean(r['seconds'] for r in intel),
                        'nativeMeanSeconds':seconds,'nativeRtf':seconds/c['duration'],
                        'nativeAgreementWithSaved':statistics.mean(agreement(r['cues'],c['reference'],c['duration']) for r in native)})
    workers={mode:json.loads((WORK/('worker-'+mode+'-results.json')).read_text())
             for mode in ['cold','reuse','force','force-reuse']}
    for policy in matrix['window']+matrix['streaming-policy']:
        policy['simulation']=[simulate(policy['windows'],rate) for rate in [1,2]]
    evidence={'version':1,'prepared':'2026-10-12','fixtureOnly':True,
              'source':json.loads((WORK/'native-build.json').read_text()),
              'summary':summary,'matrix':matrix,'workers':workers,
              'serviceCheck':json.loads((WORK/'service-check.json').read_text()),
              'rejectedThinLto':json.loads((WORK/'native-tuned-failure.json').read_text()),
              'runtimeInstall':json.loads((ROOT/'.runtime/tools/rhubarb-1.14.0-arm64/build-manifest.json').read_text())}
    save(ROOT/'docs/evidence/rhubarb-optimization-2026-10-12.json',evidence)
    print('clip | audio | Intel mean | native mean | speedup | native agreement')
    for r in summary:
        print(r['clip'],*[round(r[k],3) for k in ['duration','intelMeanSeconds','nativeMeanSeconds']],
              round(r['intelMeanSeconds']/r['nativeMeanSeconds'],2),round(r['nativeAgreementWithSaved'],3))
    print('Composite streaming models:')
    for r in matrix['streaming-policy']:
        if r['clip']=='composite':
            print(r['hop'],round(r['seconds'],3),round(r['agreement'],3),
                  [(s['assumedArrivalAudioSecondsPerSecond'],round(s['minimumContinuousStartAt'],3)) for s in r['simulation']])


if __name__=='__main__':main()
