import base64
import io
import wave
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import private_storage as storage
import server

class PrivateStorageTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
        root=Path(self.temp.name)
        for target,name,value in ((storage,'DATA_DIR',root/'private'),(storage,'LEGACY_MEMORY',root/'legacy.json'),(server,'RUNTIME_MODE','live')):
            mock=patch.object(target,name,value);mock.start();self.addCleanup(mock.stop)
        self.client=server.app.test_client()
        output=io.BytesIO()
        with wave.open(output,'wb') as handle:
            handle.setparams((1,2,24000,0,'NONE','NONE'));handle.writeframes(b'\x00\x00'*24)
        self.wav=base64.b64encode(output.getvalue()).decode()

    def test_private_memory_migration_and_atomic_failure_preserve_existing_data(self):
        storage.LEGACY_MEMORY.write_text(json.dumps(['fixture preference']))
        self.assertEqual(self.client.get('/api/memories').json['memories'],['fixture preference'])
        with patch.object(storage.os,'replace',side_effect=OSError('simulated interrupted write')):
            with self.assertRaises(OSError): storage.save_memories(['replacement'])
        self.assertEqual(storage.read_memories(),['fixture preference'])
        self.assertEqual(list(storage.DATA_DIR.iterdir()),[storage.DATA_DIR/'memory.json'])
        self.assertEqual(os.stat(storage.DATA_DIR/'memory.json').st_mode & 0o777,0o600)
        result=self.client.put('/api/memories',json={'memories':['updated']})
        self.assertEqual(result.status_code,200)
        self.assertEqual(storage.read_memories(),['updated'])
        self.assertEqual(result.headers['Cache-Control'],'no-store')

    def test_client_paths_and_bad_memory_types_never_write(self):
        with patch.object(storage,'atomic_write') as write:
            for payload in ({'audio':self.wav,'filename':'../../escape.wav'},{'audio':'bad'}):
                self.assertEqual(self.client.post('/api/audio',json=payload).status_code,400)
            for payload in ({'memories':[],'filename':'../escape.json'},{'memories':{}},{'memories':[1]}):
                self.assertEqual(self.client.put('/api/memories',json=payload).status_code,400)
            self.assertEqual(self.client.post('/save_json',json={'filename':'../../escape','json_data':[]}).status_code,410)
            self.assertEqual(self.client.post('/get_visemes',json={'filepath':'../../escape.wav'}).status_code,400)
            write.assert_not_called()
        for identifier in ('../escape','a'*31,'/tmp/file',None):
            with self.assertRaises(storage.ServiceError): storage.audio_path(identifier)

    def test_audio_resources_are_unique_bounded_and_released(self):
        first=self.client.post('/api/audio',json={'audio':self.wav}).json['audio_id']
        second=self.client.post('/api/audio',json={'audio':self.wav}).json['audio_id']
        self.assertNotEqual(first,second)
        self.assertTrue(storage.audio_path(first).is_file())
        with patch.object(storage,'MAX_AUDIO_POOL_BYTES',1):
            self.assertEqual(self.client.post('/api/audio',json={'audio':self.wav}).status_code,503)
        self.assertEqual(self.client.delete('/api/audio/'+first).status_code,200)
        with self.assertRaises(storage.ServiceError):storage.audio_path(first)
        old=storage.audio_path(second).parent;os.utime(old,(0,0))
        storage.store_audio(self.wav)
        self.assertFalse(old.exists())

    def test_alignment_timeout_cleans_owned_resource_and_cannot_read_arbitrary_paths(self):
        audio_id=storage.store_audio(self.wav)
        with patch.object(server.subprocess,'run',side_effect=subprocess.TimeoutExpired('fixture',30)) as process:
            self.assertEqual(self.client.post('/get_visemes',json={'audio_id':audio_id}).status_code,504)
            self.assertIn(str(storage.DATA_DIR),process.call_args.args[0][-1])
        self.assertFalse((storage.DATA_DIR/'audio'/audio_id).exists())

    def test_private_static_routes_foreign_origins_and_rebinding_hosts_are_blocked(self):
        for path in ('/data/memory.json','/src/data/memory.json','/DATA/memory.json','/.runtime/memory.json','/../server.py'):
            response=self.client.get(path);self.assertIn(response.status_code,(403,404));response.close()
        with patch.object(storage,'read_memories',side_effect=AssertionError('private read')):
            for headers in ({'Origin':'https://example.com'},{'Host':'evil.example:3001'},{'Sec-Fetch-Site':'cross-site'}):
                result=self.client.get('/api/memories',headers=headers);self.assertEqual(result.status_code,403)
                self.assertNotIn('Access-Control-Allow-Origin',result.headers)
        result=self.client.get('/runtime',headers={'Origin':'http://localhost'});self.assertEqual(result.status_code,200)
