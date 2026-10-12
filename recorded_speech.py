"""Scripted main-interface PCM preview. No synthesis or recognizer is invoked."""
import base64
import hashlib
import json
from pathlib import Path
import time
import wave

from config import STATIC_DIR
from kokoro_stream import SpeechStream
from service_contracts import ServiceError
from streaming_alignment import Cancelled, trim_cues


class RecordedSpeechStream(SpeechStream):
    def __init__(self, data, **options):
        super().__init__(data, **options)
        fixture=json.loads((STATIC_DIR/'replay/benchmark.json').read_text())
        candidates=fixture['turns']+[fixture['recall'],fixture['recall']['withoutMemory']]
        normalize=lambda text:' '.join(text.split())
        self.recording=next((item for item in candidates if normalize(item['speech']['spokenText'])==normalize(self.payload['input'])),None)
        if not self.recording:
            raise ServiceError('No saved speech for this scripted reply. No provider was called.',400)
        path=self.recording['speech']['audio']
        # Only fixed, checked fixture paths; the browser cannot name files.
        if not path.startswith('/replay/') or Path(path).name!=path[len('/replay/'):]:
            raise ServiceError('Invalid saved speech fixture.',500)
        self.audio=STATIC_DIR/path.lstrip('/')

    def report(self, complete):
        return {'fixtureOnly':True,'provider':'Saved Kokoro PCM and Rhubarb cues','complete':complete,
                'rate':self.rate,'duration':self.frames/self.rate,'sourceSha256':self.digest.hexdigest(),
                'timingProfile':self.timing_profile(),'analysisSeconds':0,'peakRssBytes':0,
                'preparedPeakSeconds':self.prepared_peak/self.rate,'events':self.events[:],
                'measurement':'Stored audio/cues through the PCM player; no generation or simulated latency.'}

    def work(self):
        self.started=time.monotonic();self.rate=44100;self.complete=False
        try:
            with wave.open(str(self.audio),'rb') as wav:
                self.rate=wav.getframerate();self.frames=wav.getnframes()
                if wav.getnchannels()!=1 or wav.getsampwidth()!=2 or self.rate not in (24000,44100) or self.frames>30*self.rate:
                    raise ValueError('Unsupported saved PCM fixture')
                pcm=wav.readframes(self.frames)
            self.digest.update(pcm)
            self.event({'type':'begin','rate':self.rate,'startupSeconds':self.startup,'fixtureOnly':True,
                        'source':'saved recording','text':self.payload['input'],'timingProfile':self.timing_profile()})
            self.event({'type':'words','timestamps':self.recording['speech']['timestamps']})
            start=0;index=0
            while start<self.frames:
                hop=round((self.opening if index==0 else int(self.policy[0]))*self.rate)
                end=min(start+hop,self.frames)
                self.wait(lambda:end-self.played<=12*self.rate)
                region={'start':start,'end':end,'inputStart':0,'inputEnd':self.frames}
                cues=trim_cues(self.recording['visemes'],region,self.rate)
                self.emitted=end;self.prepared_peak=max(self.prepared_peak,end-self.played)
                self.event({'type':'segment','index':index,'startFrame':start,'endFrame':end,
                            'cues':cues,'pcm':base64.b64encode(pcm[start*2:end*2]).decode()})
                start=end;index+=1
            del pcm
            self.event({'type':'eos'});self.wait(lambda:self.played==self.frames)
            self.complete=True;self.event({'type':'result','report':self.report(True)})
        except Cancelled:pass
        except Exception:
            try:self.event({'type':'error','error':'Saved speech unavailable. The reply remains as text.', 'report':self.report(False)})
            except Cancelled:pass
        finally:self.cancel()
