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

    def test_invalid_modes_remote_binding_private_static_paths_and_limits_are_rejected(self):
        for environment in ({'ASENA_MODE':'auto'},{'ASENA_HOST':'0.0.0.0'},{'ASENA_DATA_DIR':str(ROOT/'src/data')},{'ASENA_LMS_API':'file:///private/model'},{'ASENA_CONTEXT_CAPACITY':'oops'},{'ASENA_OUTPUT_RESERVE':'20000'},{'ASENA_LIP_SYNC':'unknown'}):
            with self.subTest(environment=environment), patch.dict(os.environ,environment,clear=True):
                with self.assertRaises(RuntimeError):runpy.run_path(str(ROOT/'config.py'))
