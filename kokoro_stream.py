"""Explicitly requested Kokoro PCM streaming with bounded Rhubarb lookahead.

Importing this module never contacts a provider or starts a process.
"""
import base64
import binascii
import codecs
import fcntl
import hashlib
import http.client
import json
from pathlib import Path
import queue
import re
import secrets
import socket
import threading
import time
from urllib.parse import urlsplit

from config import ROOT, RHUBARB, KOKORO_API, SPEECH_PROFILE
from service_contracts import ServiceError, require_payload, normalize_timestamps
from streaming_alignment import Cancelled, recognize

RATE = 24000
MAX_LINE = 2_000_000
MAX_AUDIO_SECONDS = 180
DEADLINE = 180


class HttpStream:
    """HTTP streaming with an owned socket that cancellation can interrupt.

    Closing a response file from another thread can wait on its read lock.
    Shutdown the owned socket instead, then let the reader close its resources.
    """
    def __init__(self, endpoint, payload, cancelled, timing=lambda phase:None):
        parsed=urlsplit(endpoint)
        cls=http.client.HTTPSConnection if parsed.scheme=='https' else http.client.HTTPConnection
        self.connection=cls(parsed.hostname,parsed.port,timeout=3)
        self.path=(parsed.path or '/')+('?' + parsed.query if parsed.query else '')
        self.payload=payload;self.cancelled=cancelled;self.socket=None;self.response=None
        self.timing=timing
    def cancel(self):
        if self.socket:
            try:self.socket.shutdown(socket.SHUT_RDWR)
            except OSError:pass
    def __enter__(self):
        try:
            self.connection.connect();self.socket=self.connection.sock;self.socket.settimeout(15)
            self.timing('connected')
            if self.cancelled.is_set():raise Cancelled()
            self.connection.request('POST',self.path,json.dumps(self.payload).encode(),{'Content-Type':'application/json'})
            self.response=self.connection.getresponse();self.status_code=self.response.status
            self.timing('headers')
            return self
        except Exception:
            self.connection.close();raise
    def __exit__(self,*_):
        if self.response:self.response.close()
        self.connection.close()
    def iter_content(self,size):
        while True:
            chunk=self.response.read1(size)
            if not chunk:break
            yield chunk


class JsonLines:
    def __init__(self):
        self.decoder = codecs.getincrementaldecoder('utf-8')('strict')
        self.pending = ''

    def push(self, chunk, final=False):
        self.pending += self.decoder.decode(chunk, final=final)
        parts = self.pending.split('\n'); self.pending = parts.pop()
        if len(self.pending) > MAX_LINE or any(len(p) > MAX_LINE for p in parts):
            raise ValueError('Oversized Kokoro stream frame')
        if final and self.pending.strip():
            raise ValueError('Truncated Kokoro stream frame')
        values = [json.loads(p) for p in parts if p.strip()]
        if any(not isinstance(value, dict) for value in values):
            raise ValueError('Expected Kokoro stream objects')
        return values


def speech_payload(data):
    if not isinstance(data, dict) or set(data)-{'input', 'voice', 'speed', 'policy', 'startupSeconds', 'strategy', 'openingSeconds'}:
        raise ServiceError('Expected speech text, voice and streaming buffer options.', 400)
    payload = require_payload({k: v for k, v in data.items() if k in ('input', 'voice', 'speed')}, 'tts')
    policy, startup = data.get('policy', SPEECH_PROFILE['policy']), data.get('startupSeconds', SPEECH_PROFILE['startupSeconds'])
    if policy not in ('1s', '2s', '3s') or type(startup) not in (int,float) or startup not in (.5,1,2,4):
        raise ServiceError('Choose 1–3 second regions and a 0.5, 1, 2 or 4 second startup buffer.', 400)
    if data.get('strategy',SPEECH_PROFILE['strategy']) not in ('whole','phrases','sentences') or type(data.get('openingSeconds',SPEECH_PROFILE['openingSeconds'])) not in (int,float) or data.get('openingSeconds',SPEECH_PROFILE['openingSeconds']) not in (.5,1,2):
        raise ServiceError('Choose whole-text, phrase or sentence generation and a 0.5, 1 or 2 second opening region.',400)
    return {**payload, 'stream': True, 'response_format': 'pcm', 'return_timestamps': True}, policy, startup


def phrase_requests(text):
    """Keep exact text order; prefer punctuation, with bounded whitespace fallback.

    A small opening avoids waiting for a paragraph-sized provider packet. Later
    requests are larger to amortize synthesis setup. These are text boundaries,
    not phoneme-token counts or promises about generated audio duration.
    """
    chunks=[];remaining=text
    while remaining:
        limit=60 if not chunks else 90
        if len(remaining)<=limit:chunks.append(remaining);break
        prefix=remaining[:limit+1]
        boundaries=[]
        for match in re.finditer(r'[.!?;,](?:[\"\u201d\u2019])?\s+',prefix):
            before=prefix[:match.start()+1].rstrip()
            if re.search(r'\b(?:Mr|Mrs|Ms|Dr|Prof|St|vs|etc)\.$',before,re.I):continue
            if len(before)>=20:boundaries.append(match.end())
        end=boundaries[-1] if boundaries else prefix.rfind(' ',0,limit+1)+1
        if end<=0:end=limit
        chunks.append(remaining[:end]);remaining=remaining[end:]
    return chunks


_ABBREVIATIONS = r'(?:Mr|Mrs|Ms|Dr|Prof|St|vs|etc|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)'

def sentence_requests(text):
    """Keep full sentences and exact text; join tiny openings to the next sentence.

    Ordinary sentences keep their context. For unusually long sentences prefer
    clause boundaries; a last-resort word cut bounds inference on this 8 GiB Mac.
    This fallback can affect prosody and is reported separately by the trial UI.
    """
    chunks=[];begin=0
    for match in re.finditer(r'[.!?](?:[\"\u201d\u2019])?\s+', text):
        before=text[:match.start()+1].rstrip()
        if re.search(r'\b'+_ABBREVIATIONS+r'\.$',before,re.I) or re.search(r'\b(?:[A-Za-z]\.){2,}$',before):
            continue
        end=match.end()
        if len(text[begin:end].strip()) >= 20:
            chunks.append(text[begin:end]);begin=end
    if begin < len(text):chunks.append(text[begin:])
    bounded=[]
    for chunk in chunks:
        while len(chunk)>180:
            prefix=chunk[:180]
            clauses=[m.end() for m in re.finditer(r'[,;:]\s+',prefix) if m.end()>=30]
            end=clauses[-1] if clauses else prefix.rfind(' ',0,180)+1
            if end<=0:end=180
            bounded.append(chunk[:end]);chunk=chunk[end:]
        if chunk:bounded.append(chunk)
    return bounded


def decode_pcm(value):
    if value.get('audio_format') != 'audio/pcm' or not isinstance(value.get('audio'), str):
        raise ValueError('Expected Kokoro mono PCM16 at 24 kHz (audio/pcm)')
    try:
        pcm = base64.b64decode(value['audio'], validate=True)
    except (ValueError, binascii.Error) as error:
        raise ValueError('Invalid Kokoro PCM encoding') from error
    if not pcm or len(pcm) % 2 or len(pcm) > 30 * RATE * 2:
        raise ValueError('Empty, partial-sample or oversized Kokoro PCM frame')
    return pcm


def decode_packet(value, previous_start=0):
    pcm = decode_pcm(value)
    words = normalize_timestamps(value.get('timestamps', []))
    if any(len(w['word'])>256 for w in words):raise ValueError('Oversized Kokoro timestamp token')
    if words and words[0]['start_time'] < previous_start:
        raise ValueError('Kokoro word timestamps moved backwards')
    return pcm, words


def packet_words(value, start, end):
    """PCM is authoritative; optional captions may include trimmed punctuation.

    Clip only to this packet's actual sample interval, never stretch speech or
    shift later packets. Invalid optional timing is omitted, with a warning;
    Rhubarb still analyzes the original audio rather than using caption visemes.
    """
    try:
        words = normalize_timestamps(value.get('timestamps', []))
        if any(len(w['word']) > 256 for w in words):
            raise ValueError('Oversized Kokoro timestamp token')
    except ValueError:
        return [], {'code':'caption-unavailable', 'message':'Invalid word timing omitted; audio and Rhubarb continue.'}
    output=[];corrected=dropped=0
    overrun=max([0]+[w['end_time']-end for w in words])
    for word in words:
        a, b = max(start, min(end, word['start_time'])), max(start, min(end, word['end_time']))
        if b <= a:
            dropped += 1
            continue
        if a != word['start_time'] or b != word['end_time']:corrected += 1
        output.append({**word, 'start_time':a, 'end_time':b})
    warning = {'code':'caption-bounded', 'message':'Word timing bounded to received PCM; audio and Rhubarb continue.',
               'correctedWords':corrected, 'droppedWords':dropped, 'maxTailOverrunSeconds':overrun} if corrected or dropped else None
    return output, warning


class SpeechStream:
    def __init__(self, data, *, endpoint=KOKORO_API, post=None, recognizer=recognize,
                 binary=RHUBARB, capture=False):
        self.payload, self.policy, self.startup = speech_payload(data)
        self.strategy=data.get('strategy',SPEECH_PROFILE['strategy']);self.opening=data.get('openingSeconds',SPEECH_PROFILE['openingSeconds'])
        self.requests=({'phrases':phrase_requests,'sentences':sentence_requests}.get(self.strategy,lambda text:[text]))(self.payload['input'])
        self.request_ends=[]
        self.endpoint, self.post, self.recognizer, self.binary = endpoint, post, recognizer, binary
        self.token = secrets.token_hex(16)
        self.cancelled = threading.Event(); self.condition = threading.Condition()
        self.queue = queue.Queue(maxsize=12)
        self.started = 0; self.pcm = bytearray(); self.base = self.frames = self.played = self.emitted = 0
        self.words = []; self.done = False; self.failure = None; self.child_pid = None
        self.events = []; self.arrivals = []; self.digest = hashlib.sha256()
        self.capture = capture; self.protocol = []
        self.incoming_peak = self.prepared_peak = 0; self.provider_finished = None
        self.first_packet = None; self.producer = None; self.worker = None
        self.transport = None
        self.last_word_start = 0; self.word_count = 0; self.timing_warnings = []

    def cancel(self):
        self.cancelled.set()
        if self.transport:self.transport.cancel()
        with self.condition: self.condition.notify_all()

    def release_buffers(self):
        # Called only after worker and provider-reader threads have exited.
        with self.condition:
            self.pcm.clear();self.words.clear();self.request_ends.clear();self.protocol.clear()
        while not self.queue.empty():
            try:self.queue.get_nowait()
            except queue.Empty:break

    def check(self):
        if self.cancelled.is_set(): raise Cancelled()
        if self.failure: raise self.failure
        if time.monotonic()-self.started > DEADLINE:
            raise RuntimeError('Streaming speech exceeded its three-minute deadline')

    def progress(self, frame):
        with self.condition:
            if type(frame) is not int or not self.played <= frame <= self.emitted:
                raise ValueError('Playback acknowledgement is outside emitted audio')
            self.played = frame; self.condition.notify_all()

    def wait(self, predicate):
        with self.condition:
            while not predicate():
                self.check(); self.condition.wait(.05)
            self.check()

    def event(self, value, terminal=False):
        value = dict(value, token=self.token, wallSeconds=time.monotonic()-self.started)
        # PCM is transient. Diagnostics contain timings and hashes, not private speech audio.
        self.events.append({k: v for k, v in value.items() if k not in ('pcm', 'report')})
        send_started=time.monotonic()
        while True:
            if terminal:
                if self.cancelled.is_set():raise Cancelled()
                if time.monotonic()-send_started>1:return
            else:self.check()
            try: self.queue.put(value, timeout=.05); return
            except queue.Full: pass

    def ingest(self, value, offset=0, request_index=0):
        pcm = decode_pcm(value)
        packet_end = (self.frames + len(pcm)//2)/RATE
        words, warning = packet_words(value, self.frames/RATE-offset, packet_end-offset)
        if warning:
            warning = {**warning, 'requestIndex':request_index, 'packetIndex':len(self.arrivals)}
            self.timing_warnings.append(warning)
            self.event({'type':'warning', **warning})
        words=[{**w,'start_time':w['start_time']+offset,'end_time':w['end_time']+offset} for w in words]
        if words and words[0]['start_time']<self.last_word_start:
            raise ValueError('Kokoro word timestamps moved backwards')
        self.word_count += len(words)
        if len(self.arrivals) >= 512 or self.word_count > 20000:
            raise ValueError('Kokoro stream exceeded its packet or word limit')
        if words: self.last_word_start = words[-1]['start_time']
        if self.frames + len(pcm)//2 > MAX_AUDIO_SECONDS*RATE:
            raise ValueError('Speech exceeds the three-minute audio limit')
        arrival = {'index': len(self.arrivals), 'wallSeconds': time.monotonic()-self.started,
                   'startFrame': self.frames, 'frames': len(pcm)//2, 'wordCount': len(words), 'requestIndex':request_index}
        self.first_packet = self.first_packet if self.first_packet is not None else arrival['wallSeconds']
        self.arrivals.append(arrival)
        self.event({'type':'provider','packet':arrival})
        if self.capture: self.protocol.append(value)
        self.digest.update(pcm)
        # A decoded provider packet can itself contain up to 30 seconds. Append in
        # bounded pieces, preserving its original arrival time in diagnostics.
        with self.condition: self.words.extend(words)
        if words: self.event({'type':'words', 'timestamps':words})
        for offset in range(0, len(pcm), RATE//10*2):
            piece = pcm[offset:offset+RATE//10*2]
            self.wait(lambda: self.frames-self.base+len(piece)//2 <= 16*RATE)
            with self.condition:
                self.pcm.extend(piece); self.frames += len(piece)//2
                self.incoming_peak = max(self.incoming_peak, self.frames-self.base)
                self.condition.notify_all()

    def produce(self):
        try:
            for index,text in enumerate(self.requests):
                self.check();offset=self.frames/RATE;before=self.frames
                payload={**self.payload,'input':text}
                self.event({'type':'request','index':index,'characters':len(text),'requestCount':len(self.requests),'text':text})
                if self.post:response_context=self.post(self.endpoint,json=payload,stream=True,timeout=(3,15))
                else:
                    self.transport=HttpStream(self.endpoint,payload,self.cancelled,
                        timing=lambda phase:self.event({'type':'provider-stage','index':index,'phase':phase}))
                    response_context=self.transport
                with response_context as response:
                    if response.status_code != 200:raise RuntimeError(f'Kokoro returned HTTP {response.status_code}')
                    parser=JsonLines();first_byte=False
                    for chunk in response.iter_content(4096):
                        self.check()
                        if chunk and not first_byte:
                            first_byte=True;self.event({'type':'provider-stage','index':index,'phase':'first-byte'})
                        for value in parser.push(chunk):self.ingest(value,offset,index)
                    for value in parser.push(b'',final=True):self.ingest(value,offset,index)
                if self.frames==before:raise ValueError('Kokoro returned no speech audio for a phrase')
                if self.strategy!='whole':
                    with self.condition:
                        self.request_ends.append(self.frames);self.condition.notify_all()
            if not self.frames: raise ValueError('Kokoro returned no speech audio')
            with self.condition:
                self.done = True; self.provider_finished = time.monotonic()-self.started
                self.condition.notify_all()
        except Cancelled: pass
        except Exception as error:
            if not self.cancelled.is_set():
                with self.condition:self.failure = error;self.condition.notify_all()

    def timing_profile(self):
        matches=(self.policy==SPEECH_PROFILE['policy'] and self.opening==SPEECH_PROFILE['openingSeconds']
                 and self.startup==SPEECH_PROFILE['startupSeconds'] and self.strategy==SPEECH_PROFILE['strategy'])
        return {'id':SPEECH_PROFILE['id'] if matches else 'custom', 'version':SPEECH_PROFILE['version'],
                'policy':self.policy,'openingSeconds':self.opening,'startupSeconds':self.startup,'strategy':self.strategy}

    def report(self, complete):
        segments = [e for e in self.events if e['type'] == 'segment']
        return {'fixtureOnly': False, 'provider': 'Kokoro captioned PCM', 'rate': RATE,'voice':self.payload['voice'],
                'policy': self.policy, 'startupSeconds': self.startup, 'complete': complete,
                'strategy':self.strategy,'openingSeconds':self.opening,'timingProfile':self.timing_profile(),'requestCount':len(self.requests),
                'textCharacters':len(self.payload['input']),'textWords':len(self.payload['input'].split()),
                'duration': self.frames/RATE, 'sourceSha256': self.digest.hexdigest(),
                'firstProviderAudioSeconds': self.first_packet, 'providerFinishedSeconds': self.provider_finished,
                'providerPackets': self.arrivals, 'analysisSeconds': sum(e['seconds'] for e in segments),
                'peakRssBytes': max([0]+[e['peakRssBytes'] for e in segments]),
                'incomingPeakSeconds': self.incoming_peak/RATE, 'preparedPeakSeconds': self.prepared_peak/RATE,
                'limits': {'incomingSeconds':16, 'preparedSeconds':12, 'decodedPacketSeconds':30,
                           'audioSeconds':MAX_AUDIO_SECONDS, 'deadlineSeconds':DEADLINE, 'providerReadTimeoutSeconds':15},
                'timingWarnings':self.timing_warnings[:], 'events': self.events[:]}

    def work(self):
        self.started = time.monotonic(); complete = False
        folder = ROOT/'.runtime/stream-probe'; folder.mkdir(parents=True, exist_ok=True)
        lock=None
        try:
            lock=(folder/'active.lock').open('a')
            try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as error: raise RuntimeError('Another Rhubarb stream is running') from error
            self.event({'type':'begin', 'rate':RATE, 'startupSeconds':self.startup,
                        'source':'live Kokoro', 'cache':False, 'threads':1,
                        'text':self.payload['input'],'strategy':self.strategy,'openingSeconds':self.opening,'timingProfile':self.timing_profile()})
            self.producer = threading.Thread(target=self.produce, daemon=True); self.producer.start()
            hop, context, start, index = int(self.policy[0])*RATE, RATE//4, 0, 0
            while True:
                region_hop=min(hop,round(self.opening*RATE)) if index==0 else hop
                # A finalized phrase is a natural analysis boundary. Flush its
                # short tail without waiting for the next synthesis request.
                def available():
                    boundary=next((end for end in self.request_ends if end>start),None)
                    return self.done or self.frames>=start+region_hop+context or boundary is not None and boundary<=start+region_hop+context
                self.wait(available)
                with self.condition:
                    if self.done and start == self.frames: break
                    boundary=next((end for end in self.request_ends if end>start),self.frames if self.done else start+region_hop+context)
                    end = min(start+region_hop, self.frames,boundary)
                    left, right = max(0, start-context), min(self.frames, end+context,boundary)
                self.wait(lambda: end-self.played <= 12*RATE)
                with self.condition:
                    audio = bytes(self.pcm[(left-self.base)*2:(right-self.base)*2])
                    stamps = [{**w, 'start_time':max(0,w['start_time']-left/RATE),
                               'end_time':max(0,w['end_time']-left/RATE)} for w in self.words
                              if w['start_time'] < right/RATE and w['end_time'] > left/RATE]
                local = {'start':start-left, 'end':end-left, 'inputStart':0, 'inputEnd':right-left}
                self.event({'type':'analysis', 'index':index, 'region':{'start':start, 'end':end,
                            'inputStart':left, 'inputEnd':right}})
                analysis_start=time.monotonic()-self.started
                result = self.recognizer(self.binary, {'rate':RATE, 'pcm':audio, 'timestamps':stamps},
                                         local, self.cancelled, lambda pid:setattr(self,'child_pid',pid))
                analysis_end=time.monotonic()-self.started
                self.check()
                cues = [{**c, 'start':c['start']+left/RATE, 'end':c['end']+left/RATE} for c in result['cues']]
                retained = audio[(start-left)*2:(end-left)*2]
                with self.condition:
                    self.emitted = end; keep = max(0,end-context)
                    del self.pcm[:(keep-self.base)*2]; self.base = keep
                    self.words = [w for w in self.words if w['end_time'] > keep/RATE]
                    self.request_ends=[frame for frame in self.request_ends if frame>end]
                    self.prepared_peak = max(self.prepared_peak, self.emitted-self.played)
                    self.condition.notify_all()
                self.event({'type':'segment', 'index':index, 'startFrame':start, 'endFrame':end,
                            'analysisStartSeconds':analysis_start,'analysisEndSeconds':analysis_end,
                            **result, 'cues':cues, 'pcm':base64.b64encode(retained).decode(),
                            'pcmSha256':hashlib.sha256(retained).hexdigest(), 'timestamps':[
                                {**w,'start_time':w['start_time']+left/RATE,'end_time':w['end_time']+left/RATE} for w in stamps]})
                start, index = end, index+1
            self.event({'type':'eos'}); self.wait(lambda:self.played == self.frames)
            complete = True
            self.event({'type':'result', 'report':self.report(True)})
        except Cancelled:
            pass
        except Exception as error:
            # Do not expose provider response bodies or paths to the browser.
            try:
                message = str(error) if isinstance(error,(ValueError,RuntimeError)) else 'Kokoro stream unavailable or interrupted. Retry when ready.'
                self.failure = None; self.event({'type':'error', 'error':message, 'report':self.report(False)},terminal=True)
            except Cancelled: pass
        finally:
            self.cancel()
            if self.producer: self.producer.join(timeout=16)
            if lock:lock.close()
            self.complete = complete

    def iterate(self):
        self.worker = threading.Thread(target=self.work, daemon=True); self.worker.start()
        try:
            while self.worker.is_alive() or not self.queue.empty():
                try: value = self.queue.get(timeout=.5)
                except queue.Empty:
                    if not self.worker.is_alive(): break
                    yield {'type':'heartbeat', 'token':self.token}; continue
                yield value
        finally:
            self.cancel()


class StreamRegistry:
    def __init__(self, factory=SpeechStream): self.lock = threading.Lock(); self.active = None;self.factory=factory
    def reserve(self, data, factory=None, **options):
        stream = (factory or self.factory)(data, **options)
        with self.lock:
            if self.active is not None: raise ServiceError('Streaming speech is busy. Wait for it to finish.', 409)
            self.active = stream
        return stream
    def release(self, stream, on_release=lambda:None):
        # Retain ownership until both alignment and provider-reader threads exit.
        def finish():
            if stream.worker: stream.worker.join()
            if stream.producer: stream.producer.join()
            with self.lock:
                if self.active is stream:
                    stream.release_buffers();self.active = None;on_release()
        if any(thread and thread.is_alive() for thread in (stream.worker,stream.producer)):threading.Thread(target=finish, daemon=True).start()
        else:finish()
    def control(self, data, cancel=False):
        with self.lock:
            stream = self.active
            if not isinstance(data, dict) or not stream or data.get('token') != stream.token:
                raise ServiceError('No matching speech stream.', 409)
            if cancel: stream.cancel()
            else: stream.progress(data.get('playedFrames'))
        return {'ok':True}

TRIAL_TEXTS = {
    'short': "Hi, I'm Asena. It's lovely to meet you. Tell me a little about yourself.",
    'sustained': "Hi, I'm Asena. It's lovely to meet you. Tell me a little about yourself. "
        "I like a conversation with a little warmth, a little wit, and room for disagreement. "
        "If you tell me something important, I want to remember it accurately. "
        "Now let's keep talking while the next part of my voice gets ready. "
        "A short pause is fine, but a smooth conversation feels much more natural. "
        "That is why we are checking the voice and the mouth movement together."
}


# Fixed, bounded diagnostic passages. Selecting one never starts synthesis.
TRIAL_TEXTS.update({
    'tiny': "Of course. I'm here.",
    'staccato': "Hi. Come closer. Not too close. There. Perfect. What a day! Tea? Coffee? "
        "Neither? Fair enough. Tell me. I'm listening. Wait. Really? That's lovely. "
        "Go on. Take your time. No rush. I remember. You said that yesterday. "
        "Yes. I disagree. Just a little. Let's try again. Better? Good. Stay awhile.",
    'unpunctuated': "Imagine we are walking beside the lake on a quiet evening and you are telling me "
        "about a strange idea that became a much bigger project than you expected while I keep asking "
        "small questions and noticing details and the conversation keeps moving without an obvious place "
        "to stop because every thought leads naturally into another thought and neither of us wants "
        "to lose the thread before we finally reach the end.",
    'mixed': "Hey. I was thinking about that little adventure you mentioned yesterday, the one where "
        "nothing went according to plan but you somehow came home with a better story. "
        "Really? Tell me the part you left out, especially the moment when you realized you would "
        "have to improvise instead of following the perfectly sensible plan you had prepared. "
        "Oh. That explains the grin. I had a feeling there was more to it. "
        "Now give me a second to be impressed before I start teasing you about your definition of careful.",
    'numbers': "Dr. Ellis booked a table for 7:30 p.m. on Friday. The address is 24 Maple Street, "
        "not 42. Bring $12.50 for the tickets and leave a 10% tip if you like. "
        "The forecast says 18 degrees, then 12 overnight. "
        "Wait, was the meeting on Oct. 12 or Oct. 13? Let's check before we make another plan. "
        "If we're late, call me; if we're early, we can walk around the lake.",
    'long': "I have a question for you before we settle into the evening. What was the most "
        "interesting part of your day, even if it seemed small at the time? Sometimes it is a "
        "conversation you almost forgot, a problem that finally made sense, or something funny "
        "you noticed on the way home. I like hearing those details because they help me "
        "understand what matters to you. You do not have to make the story impressive. "
        "An ordinary day can still have a good moment hidden in it. And if the day was "
        "difficult, you can say that too. I can listen, ask questions, or help you think "
        "through what happened. Though I reserve the right to gently tease you if your "
        "grand plan for dinner is another cup of coffee. We could choose something simple "
        "instead, put on a little music, and talk while you make it. After that, tell me "
        "one thing you want to try tomorrow. It can be practical or completely silly. "
        "I will remember the important part, and you can correct me if I get it wrong. "
        "Now, where should we begin?"
})
TRIAL_CASES = {
    key: {'label': f'S{number:02} · {label}', 'description': description, 'text': TRIAL_TEXTS[key]}
    for number, (key, label, description) in enumerate((
        ('short', 'Introduction · original', 'Original short baseline for comparing earlier reports.'),
        ('sustained', 'Conversation · original', 'Original sustained baseline for comparing earlier reports.'),
        ('tiny', 'Tiny reply', 'Checks completion when the entire reply may be shorter than the startup reserve.'),
        ('staccato', 'Many short sentences', 'Frequent sentence breaks stress request overhead, phrase tails and pauses.'),
        ('unpunctuated', 'One long sentence', 'No internal punctuation: tests splitting at spaces and sustained delivery.'),
        ('mixed', 'Tiny opening, longer follow-up', 'Alternates short and long sentences to expose early starvation and phrase seams.'),
        ('numbers', 'Numbers and abbreviations', 'Tests spoken normalization, abbreviations and punctuation with variable audio lengths.'),
        ('long', 'Long conversation', 'More requests and queue turnover: watch for late gaps as well as startup delay.'),
    ), 1)
}
