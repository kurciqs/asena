import sys,json,base64
from pathlib import Path
from flask import Flask,request,jsonify,send_from_directory
# Manual browser fixture: no model, TTS, alignment process, or private file is used.
ROOT=Path(__file__).resolve().parents[1];sys.path.insert(0,str(ROOT))
import config,context_budget
fixture=json.loads((ROOT/'src/replay/benchmark.json').read_text());intro=fixture['turns'][0]
app=Flask(__name__,static_folder=None)
counts={'chat':0,'tts':0,'dictionary':0,'memory':0}
no_avatar='--no-avatar' in sys.argv
@app.get('/runtime')
def runtime():return jsonify(mode='live',budget=context_budget.public_config(),chatModel='fixture-only',voice='af_heart',lipSync='dictionary',assets=config.ASSETS)
@app.get('/api/memories')
def memory():counts['memory']+=1;return jsonify(error='Simulated unreadable memory; original archive untouched'),503
@app.get('/system_prompt.txt')
def prompt():return 'missing prompt',404
@app.get('/dictionary/cmudict.json')
def dictionary():counts['dictionary']+=1;return jsonify(error='Simulated missing dictionary'),404
@app.post('/chat')
def chat():counts['chat']+=1;return jsonify(choices=[{'message':{'content':intro['reply']}}])
@app.post('/tts')
def tts():
 counts['tts']+=1
 audio=(ROOT/'src'/intro['speech']['audio'].lstrip('/')).read_bytes()
 return jsonify(audio=base64.b64encode(audio).decode(),timestamps=intro['speech']['timestamps'])
@app.get('/test-stats')
def stats():return jsonify(counts)
@app.get('/')
def index():return send_from_directory(ROOT/'src','index.html')
@app.get('/<path:path>')
def static(path):
 path=path[4:] if path.startswith('src/') else path
 if no_avatar and path=='animation.js':return 'throw new Error("Simulated WebGL/CDN unavailable")',200,{'Content-Type':'application/javascript'}
 if path.startswith(('data/','.runtime/')):return '',403
 return send_from_directory(ROOT/'src',path)
if __name__ == '__main__':
 app.run(host='127.0.0.1',port=3002,debug=False,use_reloader=False)
