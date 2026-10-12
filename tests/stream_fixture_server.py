"""Main companion UI check using a captured Kokoro packet and a fixed chat reply.

No network provider is called and no memories are persisted. Rhubarb runs on
the captured audio only when the browser submits the test prompt.
"""
import json
from pathlib import Path
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
import server
from kokoro_stream import StreamRegistry,TRIAL_TEXTS
from flask import jsonify

server.RUNTIME_MODE='live';server.SPEECH_STREAMING=True
capture=Path(__file__).resolve().parents[1]/'docs/evidence/kokoro-live-protocol-short-2026-10-12.json'
class Response:
    status_code=200
    def __enter__(self):return self
    def __exit__(self,*_):pass
    def iter_content(self,size):
        body=b''.join(json.dumps(p).encode()+b'\n' for p in json.loads(capture.read_text()))
        for i in range(0,len(body),size):yield body[i:i+size]
class Registry(StreamRegistry):
    def reserve(self,data,**options):
        if data.get('input')!=TRIAL_TEXTS['short']:raise ValueError('This fixture only supports its fixed introduction')
        return super().reserve(data,post=lambda *a,**k:Response(),**options)
server.SPEECH_STREAMS=Registry()
server.app.view_functions['chat']=lambda:jsonify({'choices':[{'message':{'content':'*waves* '+TRIAL_TEXTS['short']}}]})
server.app.view_functions['memory_resource']=lambda:jsonify({'memories':[]})
if __name__=='__main__':server.app.run(host='127.0.0.1',port=3003,debug=False,use_reloader=False)
