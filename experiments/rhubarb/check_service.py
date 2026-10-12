"""Finite real-native route/cache smoke check on one synthetic fixture, no TTS."""
import base64
import json
from pathlib import Path
import sys
import tempfile
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT))
import private_storage as storage
import server
from config import RHUBARB

fixture=json.loads((ROOT/'src/replay/benchmark.json').read_text())['turns'][0]
wav=(ROOT/'src'/fixture['speech']['audio'].lstrip('/')).read_bytes()
results=[]
with tempfile.TemporaryDirectory() as folder,patch.object(server,'RUNTIME_MODE','live'),patch.object(storage,'DATA_DIR',Path(folder)):
    client=server.app.test_client()
    for attempt in range(2):
        stored=client.post('/api/audio',json={'audio':base64.b64encode(wav).decode()})
        identifier=stored.json['audio_id']
        result=client.post('/get_visemes',json={'audio_id':identifier,'spoken_text':fixture['speech']['spokenText']})
        assert result.status_code==200,result.json
        assert result.json['visemes']==fixture['visemes']
        assert result.json['alignment']['cached']==bool(attempt)
        assert not (Path(folder)/'audio'/identifier).exists()
        results.append(result.json['alignment'])
output={'binary':RHUBARB,'results':results,'fixtureCuesIdentical':True,'ownedAudioReleased':True}
(ROOT/'.runtime/rhubarb-optimization/service-check.json').write_text(json.dumps(output,indent=2)+'\n')
print(json.dumps(output))
