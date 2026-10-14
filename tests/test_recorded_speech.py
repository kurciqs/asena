import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
import server
import kokoro_stream
from recorded_speech import RecordedSpeechStream

class RecordedSpeechTests(unittest.TestCase):
    def test_all_benchmark_speech_uses_stored_cues_and_bounded_sample_regions(self):
        fixture=json.loads((Path(__file__).parents[1]/'src/replay/benchmark.json').read_text())
        with patch.object(kokoro_stream.HttpStream,'__enter__',side_effect=AssertionError('Provider called')), \
                patch('subprocess.Popen',side_effect=AssertionError('Recognizer called')):
            for item in fixture['turns']+[fixture['recall'],fixture['recall']['withoutMemory']]:
                stream=RecordedSpeechStream({'input':item['speech']['spokenText'],'voice':'af_heart'})
                events=[]
                for event in stream.iterate():
                    events.append(event)
                    if event['type']=='segment':stream.progress(event['endFrame'])
                stream.worker.join(1)
                self.assertFalse(stream.worker.is_alive())
                self.assertTrue(events[-1]['report']['complete'])
                segments=[e for e in events if e['type']=='segment']
                self.assertEqual(segments[0]['endFrame'],min(stream.rate,stream.frames))
                self.assertEqual(sum(e['endFrame']-e['startFrame'] for e in segments),stream.frames)
                self.assertTrue(events[-1]['report']['fixtureOnly'])
                self.assertEqual(events[-1]['report']['analysisSeconds'],0)
        with self.assertRaises(kokoro_stream.ServiceError):
            RecordedSpeechStream({'input':'An arbitrary unsaved line.','voice':'af_heart'})

    def test_preview_blocks_llm_batch_alignment_and_private_memories(self):
        client=server.app.test_client()
        with patch.object(server,'RUNTIME_MODE','preview'),patch.object(server,'proxy_json',side_effect=AssertionError('LLM called')):
            for route in ('/chat','/tts','/get_visemes','/api/memories','/api/audio','/save_json'):
                self.assertEqual(client.post(route,json={}).status_code,403)
            self.assertEqual(client.get('/api/memories').status_code,403)
            self.assertEqual(client.get('/runtime').json['mode'],'preview')
            self.assertEqual(client.post('/api/speech/cancel',json={}).status_code,409)

    def test_preview_cannot_enable_live_speech_from_a_browser_override(self):
        client=server.app.test_client()
        with patch.object(server,'RUNTIME_MODE','preview'),patch.object(server,'SPEECH_STREAMING',True), \
                patch.object(server,'PREVIEW_SPEECH_SOURCES',['recorded']),patch.object(server.SPEECH_STREAMS,'reserve') as reserve:
            for source in ('kokoro','arbitrary'):
                result=client.post('/api/speech/stream',json={'input':'Hi','voice':'af_heart','source':source})
                self.assertEqual(result.status_code,403)
            reserve.assert_not_called()

    def test_long_whole_request_is_blocked_before_reserving_real_provider_work(self):
        client=server.app.test_client()
        with patch.object(server,'RUNTIME_MODE','live'),patch.object(server,'SPEECH_STREAMING',True), \
                patch.object(server,'SPEECH_SOURCE','kokoro'),patch.object(server.SPEECH_STREAMS,'reserve') as reserve:
            result=client.post('/api/speech/stream',json={'input':'Long sentence '*30,'voice':'af_heart','strategy':'whole'})
            self.assertEqual(result.status_code,400);self.assertIn('memory budget',result.json['error']);reserve.assert_not_called()
