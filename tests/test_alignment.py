import io
import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch
import wave
import alignment
import config
import server
import private_storage as storage


class AlignmentTests(unittest.TestCase):
    def setUp(self):
        self.temporary=tempfile.TemporaryDirectory();self.addCleanup(self.temporary.cleanup)
        self.root=Path(self.temporary.name)
        self.audio=self.root/'input.wav'
        with wave.open(str(self.audio),'wb') as wav:
            wav.setparams((1,2,44100,0,'NONE','NONE'));wav.writeframes(b'\0\0'*441)
        self.binary=self.root/'rhubarb';self.binary.write_bytes(b'fixture executable fingerprint')
        resource=self.root/'res/sphinx';resource.mkdir(parents=True)
        self.dictionary=resource/'dictionary';self.dictionary.write_text('fixture model one')
        self.cues=[{'start':0,'end':.01,'value':'X'}]
        self.options={'text':'Exact spoken text.','binary':str(self.binary),'ffmpeg':'fixture-ffmpeg',
                      'threads':2,'timeout':30,'cache_folder':self.root/'cache','cache_entries':2}

    def result(self):
        return subprocess.CompletedProcess([],0,json.dumps({'mouthCues':self.cues}), '')

    def test_direct_wav_transcript_and_cache_hit_avoid_repeating_work(self):
        with patch.object(alignment.subprocess,'run',return_value=self.result()) as process:
            first=alignment.align_audio(self.audio,**self.options)
            second=alignment.align_audio(self.audio,**self.options)
        self.assertEqual(process.call_count,1)
        command=process.call_args.args[0]
        self.assertEqual(command[0],str(self.binary))
        self.assertIn('--threads',command);self.assertIn('-d',command)
        self.assertEqual(Path(command[command.index('-d')+1]).read_text(),'Exact spoken text.')
        self.assertFalse(first['alignment']['inputConverted'])
        self.assertTrue(second['alignment']['cached'])
        self.assertEqual(first['visemes'],second['visemes'])
        cache_file=next(self.options['cache_folder'].glob('*.json'))
        self.assertEqual(cache_file.stat().st_mode&0o777,0o600)
        self.assertNotIn('Exact spoken',cache_file.read_text())

    def test_changed_text_audio_or_tool_resources_invalidates_cache(self):
        keys=[]
        def key(): return alignment.cache_key(self.audio,self.options['text'],str(self.binary),2,'fixture-ffmpeg')
        keys.append(key());self.options['text']='Different wording';keys.append(key())
        with self.audio.open('ab') as handle: handle.write(b'changed audio bytes')
        keys.append(key());self.dictionary.write_text('changed recognition resources');keys.append(key())
        self.binary.write_bytes(b'changed executable');keys.append(key())
        self.assertEqual(len(set(keys)),len(keys))

    def test_cache_is_bounded_and_corruption_or_write_failure_does_not_break_alignment(self):
        folder=self.options['cache_folder']
        for i in range(3): alignment.store_cached_cues(folder,str(i)*64,self.cues,2)
        self.assertEqual(len(list(folder.glob('*.json'))),2)
        key=alignment.cache_key(self.audio,self.options['text'],str(self.binary),2,'fixture-ffmpeg')
        (folder/(key+'.json')).write_text('broken')
        with patch.object(alignment.subprocess,'run',return_value=self.result()),patch.object(alignment.os,'replace',side_effect=OSError('disk full')):
            value=alignment.align_audio(self.audio,**self.options)
        self.assertEqual(value['visemes'],self.cues)
        self.assertFalse(value['alignment']['cached'])
        self.assertEqual(len([p for p in folder.iterdir() if not p.name.endswith('.json')]),0)

    def test_conversion_and_recognition_share_one_deadline(self):
        now=[0]
        def process(command,**options):
            now[0]+=4 if command[0]=='fixture-ffmpeg' else .1
            return self.result()
        with patch.object(alignment,'direct_wave',return_value=False),patch.object(alignment.time,'monotonic',side_effect=lambda:now[0]),patch.object(alignment.subprocess,'run',side_effect=process) as calls:
            alignment.align_audio(self.audio,**dict(self.options,timeout=5,cache_entries=0))
        self.assertEqual(calls.call_args_list[0].kwargs['timeout'],5)
        self.assertEqual(calls.call_args_list[1].kwargs['timeout'],1)

    def test_streaming_placeholder_wav_is_not_mistaken_for_a_complete_direct_input(self):
        self.assertTrue(alignment.direct_wave(self.audio))
        import struct
        body=bytearray(self.audio.read_bytes())
        struct.pack_into('<I',body,4,0xffffffff)
        struct.pack_into('<I',body,40,0xffffffff)
        self.audio.write_bytes(body)
        self.assertFalse(alignment.direct_wave(self.audio))

    def test_invalid_transcript_never_runs_a_process_and_timeout_releases_resource(self):
        client=server.app.test_client()
        with patch.object(server,'RUNTIME_MODE','live'),patch.object(server.subprocess,'run') as process:
            for text in [None,42,'x'*20001,'\0','\ud800']:
                self.assertEqual(client.post('/get_visemes',json={'audio_id':'a'*32,'spoken_text':text}).status_code,400)
            process.assert_not_called()
        with patch.object(server,'RUNTIME_MODE','live'),patch.object(storage,'DATA_DIR',self.root/'private'):
            import base64
            identifier=storage.store_audio(base64.b64encode(self.audio.read_bytes()).decode())
            with patch.object(server.subprocess,'run',side_effect=subprocess.TimeoutExpired('rhubarb',30)):
                self.assertEqual(client.post('/get_visemes',json={'audio_id':identifier,'spoken_text':'Hi.'}).status_code,504)
            self.assertFalse((storage.DATA_DIR/'audio'/identifier).exists())

    def test_native_preference_requires_an_unmodified_build_and_matching_executable(self):
        import hashlib
        native=self.root/'.runtime/tools/rhubarb-1.14.0-arm64/rhubarb'
        native.parent.mkdir(parents=True);native.write_bytes(b'verified native fixture')
        model=native.parent/'res/sphinx/acoustic-model/mdef';model.parent.mkdir(parents=True);model.write_text('fixture')
        manifest={'version':'1.14.0','algorithmChanges':False,
                  'binarySha256':hashlib.sha256(native.read_bytes()).hexdigest()}
        native.with_name('build-manifest.json').write_text(json.dumps(manifest))
        with patch.object(config,'ROOT',self.root),patch.object(config.platform,'machine',return_value='arm64'):
            self.assertEqual(config.default_rhubarb(),native)
            native.write_bytes(b'changed executable')
            self.assertEqual(config.default_rhubarb(),self.root.parent/'rhubarb/rhubarb')


if __name__=='__main__':unittest.main()
