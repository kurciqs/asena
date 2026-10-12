"""Finite loopback smoke check: cancel actual saved-audio Rhubarb mid-analysis."""
import json
import os
from pathlib import Path
import subprocess
import time
from urllib.request import Request, urlopen

ROOT=Path(__file__).resolve().parents[1]
BASE='http://localhost:3002'


def post(path,value):
    return urlopen(Request(BASE+path,data=json.dumps(value).encode(),
                           headers={'Content-Type':'application/json'},method='POST'),timeout=15)


def main():
    with post('/probe/run',{'policy':'2s','profile':'steady1x','startupSeconds':4,'repeats':1}) as stream:
        token=None
        for line in stream:
            event=json.loads(line);token=event['token']
            if event['type']=='error': raise RuntimeError(event['error'])
            if event['type']=='analysis': break
        else: raise RuntimeError('No analysis started')
        time.sleep(.15)
        rows=subprocess.check_output(['ps','-axo','pid=,ppid=,command='],text=True).splitlines()
        active=[row.strip().split(None,2) for row in rows if 'asena-stream-region-' in row and 'rhubarb' in row]
        if len(active)!=1:
            raise RuntimeError('Expected one actual saved-audio recognizer process')
        pid=int(active[0][0]);temporary=Path(active[0][2].split()[-1]).parent
        started=time.perf_counter()
        with post('/probe/cancel',{'token':token}) as response:
            assert json.load(response)['ok']
        tail=[json.loads(line) for line in stream]
        elapsed=time.perf_counter()-started
    try: os.kill(pid,0)
    except ProcessLookupError: alive=False
    else: alive=True
    with urlopen(BASE+'/probe/health',timeout=3) as response: health=json.load(response)
    result={'fixtureOnly':True,'actualRecognizerSeen':True,'recognizerTerminated':not alive,
            'temporaryRegionRemoved':not temporary.exists(),'cancelToStreamEndSeconds':elapsed,
            'lateSegments':len([e for e in tail if e['type']=='segment']),
            'terminalEvents':[e['type'] for e in tail],'serverIdle':not health['running']}
    assert result['recognizerTerminated'] and result['temporaryRegionRemoved'] and result['lateSegments']==0 and result['serverIdle']
    target=ROOT/'docs/evidence/rhubarb-stream-cancel-2026-10-12.json'
    target.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result),flush=True)


if __name__=='__main__':main()
