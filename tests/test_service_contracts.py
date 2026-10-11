import base64
import json
import subprocess
import unittest
from unittest.mock import patch
import requests
import server
import service_contracts as contracts

class Response:
    def __init__(self, payload=None, status=200, raw=None):
        self.status_code = status
        self.body = raw if raw is not None else json.dumps(payload).encode()
    def __enter__(self): return self
    def __exit__(self, *args): pass
    def iter_content(self, size): yield self.body

class ServiceContractTests(unittest.TestCase):
    def setUp(self):
        mode = patch.object(server, 'RUNTIME_MODE', 'live'); mode.start(); self.addCleanup(mode.stop)
        self.client = server.app.test_client()
        self.chat = {'model':'fixture', 'messages':[{'role':'user','content':'Hello'}]}

    def test_invalid_requests_never_call_services(self):
        with patch.object(contracts.requests, 'post') as network:
            for payload in ({}, [], {'model':'x','messages':[{'role':'tool','content':'x'}]}, {**self.chat,'temperature':float('nan')}):
                self.assertEqual(self.client.post('/chat', json=payload).status_code,400)
            self.assertEqual(self.client.post('/tts',json={'input':'hi','voice':'../bad'}).status_code,400)
            network.assert_not_called()

    def test_service_status_unavailable_timeout_and_bad_json(self):
        for response, code in ((Response(status=503),503),(Response(raw=b'not json'),502),(Response({'choices':[]}),502)):
            with patch.object(contracts.requests,'post',return_value=response) as network:
                result=self.client.post('/chat',json=self.chat)
                self.assertEqual(result.status_code,code)
                self.assertTrue(result.json['retryable'])
                self.assertEqual(network.call_args.kwargs['timeout'],(3,30))
                self.assertTrue(network.call_args.kwargs['stream'])
        for error, code in ((requests.Timeout(),504),(requests.ConnectionError(),503)):
            with patch.object(contracts.requests,'post',side_effect=error):
                self.assertEqual(self.client.post('/chat',json=self.chat).status_code,code)

    def test_oversized_and_deadline_responses_are_bounded(self):
        with patch.object(contracts.requests,'post',return_value=Response({'text':'123456'})), patch.object(contracts,'MAX_RESPONSE_BYTES',5):
            with self.assertRaises(contracts.ServiceError): contracts.proxy_json('fixture',{},'fixture')
        with patch.object(contracts.requests,'post',return_value=Response({})), patch.object(contracts.time,'monotonic',side_effect=[0,100]):
            with self.assertRaises(contracts.ServiceError) as error: contracts.proxy_json('fixture',{},'fixture')
            self.assertEqual(error.exception.status,504)

    def test_audio_survives_missing_word_timing_but_invalid_audio_fails(self):
        wav=b'RIFF'+b'\x00'*4+b'WAVE'+b'\x00'*32
        value=contracts.validate_tts_response({'audio':base64.b64encode(wav).decode(),'timestamps':None})
        self.assertEqual(value['timestamps'],[])
        self.assertTrue(value['warnings'])
        self.assertEqual(contracts.normalize_timestamps([{'word':'Hi','start_time':-.02,'end_time':.2}])[0]['start_time'],0)
        with self.assertRaises(contracts.ServiceError): contracts.validate_tts_response({'audio':'broken'})
        for cues in ([{'value':None,'start':0,'end':1}], [{'value':'AB','start':0,'end':1}], [{'value':'A','start':0,'end':float('nan')}]):
            with self.assertRaises(contracts.ServiceError): contracts.validate_visemes(cues)

    def test_subprocess_deadline_and_missing_tool_are_visible(self):
        with patch.object(server.os.path,'exists',return_value=True), patch.object(server.subprocess,'run',side_effect=subprocess.TimeoutExpired('fixture',30)) as process:
            result=self.client.post('/get_visemes',json={'filepath':'/data/test.wav'})
            self.assertEqual(result.status_code,504)
            self.assertEqual(process.call_args.kwargs['timeout'],30)
        with patch.object(server.os.path,'exists',return_value=True), patch.object(server.subprocess,'run',side_effect=FileNotFoundError()):
            self.assertEqual(self.client.post('/get_visemes',json={'filepath':'/data/test.wav'}).status_code,503)
