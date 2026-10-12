import base64
import json
from pathlib import Path
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import threading
import time
import unittest
from unittest.mock import patch

import server
import kokoro_stream as stream
from streaming_alignment import trim_cues


def packet(seconds, start=0, word='Hello'):
    return {'audio_format':'audio/pcm','audio':base64.b64encode(b'\0\0'*round(seconds*stream.RATE)).decode(),
            'timestamps':[{'word':word,'start_time':start,'end_time':start+seconds}]}


class Response:
    status_code = 200
    def __init__(self, packets, suffix=b''): self.body=b''.join(json.dumps(p).encode()+b'\n' for p in packets)+suffix;self.closed=False
    def __enter__(self): return self
    def __exit__(self,*_): self.closed=True
    def iter_content(self,size):
        for i in range(0,len(self.body),size): yield self.body[i:i+size]


def recognize(binary,source,region,cancelled,active):
    cues=[{'start':0,'end':region['inputEnd']/source['rate'],'value':'D'}]
    return {'cues':trim_cues(cues,region,source['rate']),'seconds':.01,'peakRssBytes':0}


class KokoroStreamTests(unittest.TestCase):
    def make(self,response,**options):
        return stream.SpeechStream({'input':'Hello again.','voice':'af_heart'},post=lambda *a,**k:response,recognizer=recognize,**options)
    def consume(self,instance):
        events=[]
        for event in instance.iterate():
            events.append(event)
            if event['type']=='segment': instance.progress(event['endFrame'])
        instance.worker.join(timeout=1)
        self.assertFalse(instance.worker.is_alive())
        return events

    def test_framing_handles_all_utf8_splits_and_rejects_truncation(self):
        payload='{"word":"héllo"}\n{"n":2}\n'.encode()
        for n in range(len(payload)+1):
            parser=stream.JsonLines()
            self.assertEqual(parser.push(payload[:n])+parser.push(payload[n:],final=True),[{'word':'héllo'},{'n':2}])
        for raw in (b'{"x":1}',b'[]\n',b'NaN\n',b'x'*2_000_001):
            with self.assertRaises(ValueError): stream.JsonLines().push(raw,final=True)

    def test_pcm_format_sample_bounds_and_cumulative_timestamps(self):
        pcm,words=stream.decode_packet(packet(1,start=2),previous_start=1)
        self.assertEqual(len(pcm),stream.RATE*2);self.assertEqual(words[0]['start_time'],2)
        for value in ({**packet(1),'audio_format':'audio/wav'}, {**packet(1),'audio':'bad'},
                      {**packet(1),'audio':base64.b64encode(b'x').decode()},packet(31)):
            with self.assertRaises(ValueError): stream.decode_packet(value)
        with self.assertRaises(ValueError): stream.decode_packet(packet(1),previous_start=2)

    def test_actual_captured_kokoro_packet_matches_the_pcm_contract(self):
        path=Path(__file__).resolve().parents[1]/'docs/evidence/kokoro-live-protocol-short-2026-10-12.json'
        packets=json.loads(path.read_text());previous=0;frames=0
        for value in packets:
            pcm,words=stream.decode_packet(value,previous);frames+=len(pcm)//2
            if words:previous=words[-1]['start_time']
        self.assertEqual(frames,102984)

    def test_cancel_interrupts_an_actual_blocked_http_socket(self):
        release=threading.Event()
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*_):pass
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                self.send_response(200);self.send_header('Transfer-Encoding','chunked');self.end_headers()
                body=json.dumps(packet(.7)).encode()+b'\n'
                self.wfile.write(f'{len(body):x}\r\n'.encode()+body+b'\r\n');self.wfile.flush()
                release.wait(3)
        http=ThreadingHTTPServer(('127.0.0.1',0),Handler);http.daemon_threads=True
        serving=threading.Thread(target=http.serve_forever,daemon=True);serving.start()
        instance=stream.SpeechStream({'input':'Hi','voice':'af_heart'},recognizer=recognize,
                                   endpoint=f'http://127.0.0.1:{http.server_port}/speech')
        iterator=instance.iterate()
        try:
            while next(iterator)['type']!='words':pass
            before=time.monotonic();instance.cancel();iterator.close();instance.worker.join(timeout=1)
            self.assertFalse(instance.worker.is_alive());self.assertFalse(instance.producer.is_alive())
            self.assertLess(time.monotonic()-before,1)
        finally:
            instance.cancel();release.set();http.shutdown();http.server_close();serving.join(timeout=1)

    def test_dynamic_regions_preserve_samples_context_offsets_and_final_tail(self):
        response=Response([packet(3),packet(2.3,start=3,word='again')]);instance=self.make(response,capture=True)
        events=self.consume(instance);segments=[e for e in events if e['type']=='segment']
        self.assertEqual([(s['startFrame'],s['endFrame']) for s in segments],[(0,48000),(48000,96000),(96000,127200)])
        self.assertEqual(b''.join(base64.b64decode(s['pcm']) for s in segments),b'\0\0'*127200)
        self.assertTrue(all(s['cues'][0]['start']==s['startFrame']/stream.RATE for s in segments))
        self.assertTrue(all(s['cues'][-1]['end']==s['endFrame']/stream.RATE for s in segments))
        report=events[-1]['report'];self.assertTrue(report['complete']);self.assertEqual(report['rate'],24000)
        self.assertEqual([p['startFrame'] for p in report['providerPackets']],[0,72000])
        self.assertLessEqual(len(instance.pcm),stream.RATE//2);self.assertTrue(response.closed)
        self.assertEqual(len(instance.protocol),2)

    def test_no_timestamps_still_produces_lipsync_and_bad_stream_fails_visibly(self):
        good={**packet(.7),'timestamps':[]}
        self.assertTrue(self.consume(self.make(Response([good])))[-1]['report']['complete'])
        for response in (Response([]),Response([good],suffix=b'{'),Response([{**good,'audio_format':'audio/mp3'}])):
            events=self.consume(self.make(response));self.assertEqual(events[-1]['type'],'error')
            self.assertFalse(any(e['type']=='result' for e in events));self.assertTrue(response.closed)

    def test_phrase_tail_plays_before_next_request_and_timestamps_are_global(self):
        release=threading.Event();calls=[]
        text=stream.TRIAL_TEXTS['short']
        def post(*args,**options):
            calls.append(options['json']['input'])
            if len(calls)==2:release.wait(2)
            return Response([packet(2.4 if len(calls)==1 else 1.7,word='Hello' if len(calls)==1 else 'Again')])
        instance=stream.SpeechStream({'input':text,'voice':'af_heart','strategy':'phrases',
            'startupSeconds':1,'openingSeconds':1},post=post,recognizer=recognize)
        iterator=instance.iterate();events=[]
        try:
            while len([e for e in events if e['type']=='segment'])<2:
                event=next(iterator);events.append(event)
                if event['type']=='segment':instance.progress(event['endFrame'])
            # Finalized phrase tail is available even while the next provider blocks.
            segments=[e for e in events if e['type']=='segment']
            self.assertEqual([(e['startFrame'],e['endFrame']) for e in segments],[(0,24000),(24000,57600)])
            release.set()
            for event in iterator:
                events.append(event)
                if event['type']=='segment':instance.progress(event['endFrame'])
            self.assertEqual(''.join(calls),text)
            words=[w for e in events if e['type']=='words' for w in e['timestamps']]
            self.assertEqual(words[1]['start_time'],2.4)
            self.assertEqual(events[-1]['report']['duration'],4.1)
            self.assertTrue(events[-1]['report']['complete'])
            self.assertEqual(b''.join(base64.b64decode(e['pcm']) for e in events if e['type']=='segment'),b'\0\0'*98400)
        finally:release.set();instance.cancel();iterator.close();instance.worker.join(timeout=2)

    def test_phrase_segmentation_preserves_text_and_options_are_bounded(self):
        for text in (stream.TRIAL_TEXTS['sustained'],'Dr. Smith said hello. '*20,'hello '*100,'x'*200):
            chunks=stream.phrase_requests(text)
            self.assertEqual(''.join(chunks),text);self.assertTrue(all(chunks))
            self.assertLessEqual(len(chunks[0]),61);self.assertTrue(all(len(s)<=91 for s in chunks[1:]))
        for options in ({'startupSeconds':True},{'startupSeconds':float('nan')},{'openingSeconds':0},
                        {'strategy':'arbitrary'},{'openingSeconds':True}):
            with self.assertRaises(stream.ServiceError):stream.SpeechStream({'input':'Hi','voice':'af_heart',**options})

    def test_backpressure_cancellation_releases_producer_and_never_emits_late_audio(self):
        response=Response([packet(30)]);instance=self.make(response)
        iterator=instance.iterate()
        while next(iterator)['type']!='segment': pass
        instance.cancel();iterator.close();instance.worker.join(timeout=2)
        self.assertFalse(instance.worker.is_alive());self.assertFalse(instance.producer.is_alive())
        self.assertLessEqual(instance.incoming_peak,16*stream.RATE)
        self.assertLessEqual(instance.prepared_peak,12*stream.RATE);self.assertTrue(response.closed)
        with self.assertRaises(ValueError): instance.progress(instance.emitted+1)

    def test_replay_foreign_origin_and_disabled_live_calls_never_contact_kokoro(self):
        client=server.app.test_client()
        with patch.object(stream.HttpStream,'__enter__',side_effect=AssertionError('Provider called')) as network:
            with patch.object(server,'RUNTIME_MODE','replay'):
                for route in ('/api/speech/stream','/api/speech/progress','/api/speech/cancel'):
                    self.assertEqual(client.post(route,json={}).status_code,403)
            with patch.object(server,'RUNTIME_MODE','live'),patch.object(server,'SPEECH_STREAMING',False):
                self.assertEqual(client.post('/api/speech/stream',json={'input':'Hi','voice':'af_heart'}).status_code,403)
                self.assertEqual(client.post('/api/speech/stream',json={},headers={'Origin':'https://example.org'}).status_code,403)
            network.assert_not_called()

    def test_registry_tokens_and_invalid_inputs_cannot_start_work(self):
        registry=stream.StreamRegistry()
        for bad in ({}, {'input':'Hi','voice':'../bad'}, {'input':'Hi','voice':'af_heart','startupSeconds':True},
                    {'input':'Hi','voice':'af_heart','endpoint':'http://remote'}):
            with self.assertRaises(stream.ServiceError): registry.reserve(bad)
        owner=registry.reserve({'input':'Hi','voice':'af_heart'})
        self.assertIsNone(owner.worker)
        with self.assertRaises(stream.ServiceError):registry.reserve({'input':'Hi','voice':'af_heart'})
        with self.assertRaises(stream.ServiceError):registry.control({'token':'wrong'},cancel=True)
        registry.control({'token':owner.token},cancel=True);self.assertTrue(owner.cancelled.is_set())
        registry.release(owner)

    def test_flask_stream_owns_alignment_and_releases_even_an_unconsumed_response(self):
        registry=stream.StreamRegistry();client=server.app.test_client()
        class Registry(stream.StreamRegistry):
            def reserve(self,data,**options):
                return super().reserve(data,post=lambda *a,**k:Response([packet(.7)]),recognizer=recognize,**options)
        registry=Registry()
        with patch.object(server,'RUNTIME_MODE','live'),patch.object(server,'SPEECH_STREAMING',True),patch.object(server,'SPEECH_STREAMS',registry):
            with server.app.test_request_context('/api/speech/stream',method='POST',json={'input':'Hello','voice':'af_heart'}):
                response=server.streamed_speech()
                self.assertIsNone(registry.active.worker)
                self.assertFalse(server.ALIGNMENT_LOCK.acquire(blocking=False))
                response.close()
            deadline=time.monotonic()+1
            while registry.active is not None and time.monotonic()<deadline:time.sleep(.005)
            self.assertIsNone(registry.active)
            self.assertTrue(server.ALIGNMENT_LOCK.acquire(blocking=False));server.ALIGNMENT_LOCK.release()
            response=client.post('/api/speech/stream',json={'input':'Hello','voice':'af_heart'},buffered=False)
            self.assertEqual(response.status_code,200)
            self.assertEqual(client.post('/api/speech/stream',json={'input':'Hello','voice':'af_heart'}).status_code,409)
            for raw in response.response:
                event=json.loads(raw)
                if event['type']=='segment':
                    ack=client.post('/api/speech/progress',json={'token':event['token'],'playedFrames':event['endFrame']})
                    self.assertEqual(ack.status_code,200)
            response.close()
            deadline=time.monotonic()+1
            while registry.active is not None and time.monotonic()<deadline:time.sleep(.005)
            self.assertIsNone(registry.active)


if __name__=='__main__':unittest.main()
