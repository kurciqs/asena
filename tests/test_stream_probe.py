import importlib.util
import fcntl
import json
import os
from pathlib import Path
import signal
import sys
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]/'scripts'))
import rhubarb_stream_probe as probe


class StreamProbeTests(unittest.TestCase):
    def source(self, seconds=4, rate=100):
        frames=seconds*rate
        return {'frames': frames, 'rate': rate, 'pcm': b'\0\0'*frames,
                'timestamps': [{'word':'Hello.', 'start_time':0, 'end_time':1},
                               {'word':'Again.', 'start_time':2, 'end_time':3}],
                'fixtures': [], 'sha256':'fixture'}

    def test_region_sample_ownership_context_and_final_tail(self):
        source=self.source(seconds=7)
        for policy in probe.POLICIES:
            parts=probe.regions(source,policy)
            self.assertEqual(parts[0]['start'],0); self.assertEqual(parts[-1]['end'],700)
            self.assertTrue(all(a['end']==b['start'] for a,b in zip(parts,parts[1:])))
            retained=b''.join(source['pcm'][p['start']*2:p['end']*2] for p in parts)
            self.assertEqual(retained,source['pcm'])
            self.assertEqual(parts[-1]['inputEnd'],700)
            self.assertTrue(all(p['inputStart']<=p['start']<p['end']<=p['inputEnd'] for p in parts))

    def test_sentence_boundaries_and_maximum_analysis_size(self):
        parts=probe.regions(self.source(seconds=14),'sentences')
        self.assertEqual(parts[0]['end'],150)
        self.assertTrue(all(p['end']-p['start']<=500 for p in parts))

    def test_context_cues_are_trimmed_and_offset_once(self):
        region={'start':200,'end':400,'inputStart':175,'inputEnd':425}
        cues=[{'start':0,'end':.5,'value':'A'},{'start':.5,'end':2.5,'value':'D'}]
        self.assertEqual(probe.trim_cues(cues,region,100),[
            {'start':2,'end':2.25,'value':'A'},{'start':2.25,'end':4,'value':'D'}])
        with self.assertRaises(ValueError): probe.trim_cues([{'start':0,'end':1,'value':None}],region,100)

    def test_delivery_profiles_are_monotonic_with_explicit_stall(self):
        source=self.source(seconds=26)
        for profile in probe.PROFILES:
            schedule=probe.delivery_schedule(source,profile)
            self.assertEqual(schedule[-1][0],source['frames'])
            self.assertTrue(all(a[0]<b[0] and a[1]<=b[1] for a,b in zip(schedule,schedule[1:])))
        steady=probe.delivery_schedule(source,'steady1x')
        fast=probe.delivery_schedule(source,'steady2x')
        self.assertAlmostEqual(steady[-1][1],2*fast[-1][1])
        burst=probe.delivery_schedule(source,'bursty1x')
        self.assertGreater(max(b[1]-a[1] for a,b in zip(burst,burst[1:])),2)
        demo=probe.delivery_schedule(source,'bufferingDemo')
        self.assertAlmostEqual(demo[-1][1],steady[-1][1]+8)
        self.assertGreater(max(b[1]-a[1] for a,b in zip(demo,demo[1:])),8)

    def test_bounded_preparation_waits_for_playback_and_cancels_without_late_segments(self):
        source=self.source(seconds=20)
        events=[]; error=[]
        def recognize(*args): return {'cues':[], 'seconds':0, 'peakRssBytes':0}
        instance=probe.Probe(source,'2s',emit=events.append,recognizer=recognize)
        def run():
            try: instance.run()
            except Exception as e: error.append(e)
        schedule=[(n,0) for n in range(100,2001,100)]
        with patch.object(probe,'delivery_schedule',return_value=schedule):
            thread=threading.Thread(target=run);thread.start()
            deadline=time.monotonic()+2
            while instance.emitted<1200 and time.monotonic()<deadline: time.sleep(.005)
            self.assertEqual(instance.emitted,1200)
            self.assertLessEqual(instance.incoming_peak,1600)
            self.assertEqual(len([e for e in events if e['type']=='segment']),6)
            with self.assertRaises(ValueError): instance.progress(1201)
            instance.cancel();thread.join(timeout=2)
        self.assertFalse(thread.is_alive()); self.assertEqual(error,[])
        self.assertEqual(len([e for e in events if e['type']=='segment']),6)
        self.assertEqual(events[-1]['type'],'cancelled')

    def test_cancel_terminates_actual_child_and_removes_region_files(self):
        with tempfile.TemporaryDirectory() as folder:
            binary=Path(folder)/'sleep-recognizer'
            binary.write_text('#!'+sys.executable+'\nimport time\ntime.sleep(60)\n');binary.chmod(0o700)
            event=threading.Event();pid=[];errors=[]
            def active(value):
                if value: pid.append(value);event.set()
            def run():
                try: probe.recognize(binary,self.source(),probe.regions(self.source(),'2s')[0],event,active)
                except Exception as error: errors.append(error)
            thread=threading.Thread(target=run);thread.start();thread.join(timeout=3)
            self.assertFalse(thread.is_alive());self.assertEqual(len(pid),1)
            self.assertIsInstance(errors[0],probe.Cancelled)
            with self.assertRaises(ProcessLookupError): os.kill(pid[0],0)

    def test_memory_and_deadline_guards_kill_the_child(self):
        with tempfile.TemporaryDirectory() as folder:
            binary=Path(folder)/'sleep-recognizer'
            binary.write_text('#!'+sys.executable+'\nimport time\ntime.sleep(60)\n');binary.chmod(0o700)
            for options,message in [({'memory_mib':1},'budget'),({'timeout':.01},'deadline')]:
                pid=[]
                with patch.object(probe,'process_tree_rss',return_value=2*1024**2):
                    with self.assertRaisesRegex(RuntimeError,message):
                        probe.recognize(binary,self.source(),probe.regions(self.source(),'2s')[0],
                                        threading.Event(),lambda p:pid.append(p) if p else None,**options)
                with self.assertRaises(ProcessLookupError): os.kill(pid[0],0)

    def test_server_rejects_foreign_origins_hosts_and_cross_site_requests(self):
        handler=object.__new__(probe.Handler)
        handler.server=type('Server',(),{'server_port':3002})()
        for headers,accepted in [({'Host':'localhost:3002'},True),
                ({'Host':'localhost:3002','Origin':'http://localhost:3002'},True),
                ({'Host':'localhost:3002','Origin':'https://example.com'},False),
                ({'Host':'example.com:3002'},False),
                ({'Host':'localhost:3002','Sec-Fetch-Site':'cross-site'},False)]:
            handler.headers=headers;self.assertEqual(handler.allowed(),accepted)

    def test_cross_process_recognizer_lock_refuses_a_competing_probe(self):
        with tempfile.TemporaryDirectory() as folder, patch.object(probe,'ROOT',Path(folder)):
            lock_path=Path(folder)/'.runtime/stream-probe/active.lock'
            lock_path.parent.mkdir(parents=True)
            with lock_path.open('a') as lock:
                fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                with self.assertRaisesRegex(RuntimeError,'Another saved-audio probe'):
                    probe.Probe(self.source()).run()


if __name__=='__main__': unittest.main()
