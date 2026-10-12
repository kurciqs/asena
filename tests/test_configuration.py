import os
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
class ConfigurationTests(unittest.TestCase):
    def test_defaults_are_safe_and_paths_independent_of_working_directory(self):
        with patch.dict(os.environ,{},clear=True):
            config=runpy.run_path(str(ROOT/'config.py'))
        self.assertEqual(config['RUNTIME_MODE'],'replay')
        self.assertEqual(config['HOST'],'127.0.0.1')
        self.assertEqual(config['CHAT_MODEL'],'qwen3.5-2b')
        self.assertEqual(config['DATA_DIR'],ROOT/'.runtime')
        self.assertTrue(Path(config['RHUBARB']).is_absolute())
        self.assertEqual(config['SPEECH_PROFILE'],{'id':'stable-122','version':1,'label':'Stable · 1 / 2 / 2','policy':'2s','openingSeconds':1,'startupSeconds':2,'strategy':'sentences'})

    def test_invalid_modes_remote_binding_private_static_paths_and_limits_are_rejected(self):
        for environment in ({'ASENA_MODE':'auto'},{'ASENA_HOST':'0.0.0.0'},{'ASENA_DATA_DIR':str(ROOT/'src/data')},{'ASENA_LMS_API':'file:///private/model'},{'ASENA_CONTEXT_CAPACITY':'oops'},{'ASENA_OUTPUT_RESERVE':'20000'},{'ASENA_LIP_SYNC':'unknown'},{'ASENA_SPEECH_PROFILE':'missing'}):
            with self.subTest(environment=environment), patch.dict(os.environ,environment,clear=True):
                with self.assertRaises(RuntimeError):runpy.run_path(str(ROOT/'config.py'))

class SpeechProfileTests(unittest.TestCase):
    def test_selected_profiles_are_modular_and_reject_unsafe_values(self):
        import tempfile,json
        from speech_profiles import load_speech_profile
        catalog=json.loads((ROOT/'speech_profiles.json').read_text())
        catalog['profiles']['experiment']={**catalog['profiles']['stable-122'],'openingSeconds':.5,'startupSeconds':4}
        with tempfile.TemporaryDirectory() as folder:
            path=Path(folder)/'profiles.json';path.write_text(json.dumps(catalog))
            chosen=load_speech_profile(path,'experiment')
            self.assertEqual(chosen['id'],'experiment');self.assertEqual(chosen['startupSeconds'],4)
            self.assertEqual(load_speech_profile(path)['openingSeconds'],1)
            for key,bad in [('openingSeconds',True),('startupSeconds',float('nan')),('policy','unsafe'),('strategy','unsafe'),('startupSeconds',100)]:
                broken=json.loads(json.dumps(catalog));broken['profiles']['experiment'][key]=bad;path.write_text(json.dumps(broken))
                with self.subTest(key=key,bad=bad),self.assertRaises(RuntimeError):load_speech_profile(path,'experiment')
