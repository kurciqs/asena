"""Compare native Rhubarb deployment/streaming strategies without speech generation."""
import json
import argparse
import math
import re
from pathlib import Path
import statistics
import subprocess
import wave
from rhubarb_benchmark import ROOT, WORK, clips, align, guarded_run, save


def shape_at(cues, t):
    return next((c['value'] for c in cues if c['start'] <= t < c['end']), 'X')


def agreement(cues, reference, duration):
    count = max(1, math.floor(duration * 100))
    return sum(shape_at(cues, i / 100) == shape_at(reference, i / 100)
               for i in range(count)) / count


def worker_batch(inputs, mode):
    jobs = WORK / (mode + '-jobs.tsv')
    lines = []
    for repeat in range(3):
        for c in inputs:
            dialog = WORK / (c['id'] + '-dialog.txt')
            dialog.write_text(c['text'])
            lines.append('\t'.join([c['id'] + '-r' + str(repeat), c['audio'], str(dialog)]))
    jobs.write_text('\n'.join(lines) + '\n')
    binary = WORK / 'build-arm64/rhubarb/asena-rhubarb-worker'
    measurement = guarded_run([str(binary), str(jobs), mode], name='worker-' + mode, timeout=120)
    raw = (ROOT / measurement['stdout']).read_text()
    result = []
    for block in raw.split('@ASENA_BEGIN\t')[1:]:
        header, body = block.split('\n', 1)
        identifier, seconds = header.split('\t')
        output = json.loads(body.split('@ASENA_END')[0])
        clip = next(c for c in inputs if identifier.rsplit('-r', 1)[0] == c['id'])
        cues = output['mouthCues']
        result.append({'id': identifier, 'seconds': float(seconds), 'duration': clip['duration'],
                       'agreement': agreement(cues, clip['reference'], clip['duration']), 'cues': cues})
    profiles = {}
    events = []
    for line in (ROOT / measurement['stderr']).read_text().splitlines():
        if line.startswith('@ASENA_PROFILE\t'):
            _, stage, seconds = line.split('\t')
            events.append({'stage': stage, 'seconds': float(seconds)})
        elif line.startswith('@ASENA_PROFILE_DONE\t'):
            profiles[line.split('\t')[1]] = events
            events = []
    value = {'measurement': measurement, 'jobs': result, 'profiles': profiles}
    save(WORK / ('worker-' + mode + '-results.json'), value)
    print('worker', mode, 'median', round(statistics.median(r['seconds'] for r in result), 3),
          's, agreement', round(statistics.mean(r['agreement'] for r in result), 3),
          'peak', round(measurement['peakRssBytes']/1024**2, 1), 'MiB', flush=True)


def composite(inputs):
    audio = WORK / 'composite.wav'
    chunks, stamps = [], []
    offset=0
    rate = 44100
    for c in inputs:
        with wave.open(c['audio']) as wav:
            if wav.getframerate() != rate or wav.getnchannels()!=1 or wav.getsampwidth()!=2:
                raise ValueError('Composite expects original mono PCM16 44.1kHz')
            chunks += [wav.readframes(wav.getnframes()), b'\0\0' * round(.35 * rate)]
        stamps += [dict(s,start_time=s['start_time']+offset,end_time=s['end_time']+offset) for s in c['timestamps']]
        offset+=c['duration']+.35
    with wave.open(str(audio), 'wb') as wav:
        wav.setparams((1,2,rate,0,'NONE','NONE')); wav.writeframes(b''.join(chunks))
    return {'id': 'composite', 'audio': str(audio), 'duration':sum(map(len,chunks))/2/rate,
            'text': ' '.join(c['text'] for c in inputs), 'reference': [],'timestamps':stamps}


def windows(binary, clip, hop, context):
    with wave.open(clip['audio']) as wav:
        rate = wav.getframerate(); pcm = wav.readframes(wav.getnframes())
    combined, windows = [], []
    # Use timestamped words from the unchanged fixture to supply only nearby dialogue.
    stamps = clip['timestamps']
    if hop=='sentences':
        boundaries=[0]
        for i,s in enumerate(stamps[:-1]):
            if re.search(r'[.!?]["\u201d\u2019]?$',s['word']):
                boundary=(s['end_time']+stamps[i+1]['start_time'])/2
                if boundary>boundaries[-1]:boundaries.append(boundary)
        boundaries.append(clip['duration'])
        regions=list(zip(boundaries,boundaries[1:]))
    else:
        regions=[(i*hop,min((i+1)*hop,clip['duration'])) for i in range(math.ceil(clip['duration']/hop))]
    for index,(retain_start,retain_end) in enumerate(regions):
        start, end = max(0,retain_start-context), min(clip['duration'],retain_end+context)
        audio = WORK/'window.wav'
        with wave.open(str(audio),'wb') as wav:
            wav.setparams((1,2,rate,0,'NONE','NONE'))
            wav.writeframes(pcm[round(start*rate)*2:round(end*rate)*2])
        text = ' '.join(s['word'] for s in stamps if s['start_time']<end and s['end_time']>start)
        part = dict(clip, text=text, audio=str(audio), duration=end-start)
        name = f'window-{clip["id"]}-{hop}-{context}-{index}'
        result = align(binary,part,name=name)
        windows.append({'inputStart':start,'inputEnd':end,'retainedStart':retain_start,
                        'retainedEnd':retain_end,'seconds':result['seconds']})
        for cue in result['cues']:
            left, right = max(retain_start,start+cue['start']), min(retain_end,start+cue['end'])
            if right>left: combined.append({'start':left,'end':right,'value':cue['value']})
    value = {'clip':clip['id'],'hop':hop,'context':context,'duration':clip['duration'],
             'windows':windows,'seconds':sum(w['seconds'] for w in windows),'cues':combined,
             'agreement':agreement(combined,clip['reference'],clip['duration'])}
    print('windows',clip['id'],hop,context,'compute',round(value['seconds'],3),
          'agreement',round(value['agreement'],3),flush=True)
    return value


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stream-only',action='store_true')
    args=parser.parse_args()
    inputs = clips()
    native = WORK/'native-baseline/rhubarb'
    if args.stream_only:
        long=composite(inputs)
        long['reference']=json.loads((WORK/'composite-results.json').read_text())[0]['cues']
        result=[]
        for c in inputs[:3]+[long]:
            policies=[('sentences',.25)] if c['id']!='composite' else [(1,.25),(2,.25),(3,.25),(5,.25),('sentences',.25)]
            for hop,context in policies:
                result.append(windows(native,c,hop,context))
                save(WORK/'streaming-policy-results.json',result)
        return
    results = []
    for dialog in [False]:
        for c in inputs:
            result = align(native,c,name='native-no-dialog-'+c['id'],dialog=dialog)
            result['agreement']=agreement(result['cues'],c['reference'],c['duration'])
            results.append(result)
            save(WORK/'native-no-dialog-results.json',results)
            print(result['id'],round(result['seconds'],3),'agreement',round(result['agreement'],3),flush=True)
    for mode in ['cold','reuse','force','force-reuse']:
        try:
            worker_batch(inputs,mode)
        except RuntimeError as error:
            save(WORK/('worker-'+mode+'-failure.json'),{'error':str(error)})
            print('worker',mode,'failed; preserved diagnostics and continuing other strategies',flush=True)
    long = composite(inputs)
    long_results=[]
    for threads in [1,2,4]:
        result=align(native,long,name='composite-t'+str(threads),threads=threads,
                     extra=['--logFile',str(WORK/('composite-t'+str(threads)+'.log'))])
        long_results.append(result)
        save(WORK/'composite-results.json',long_results)
        print('composite',threads,round(result['seconds'],3),'s, peak',round(result['peakRssBytes']/1024**2,1),'MiB',flush=True)
    result_windows=[]
    for c in inputs[:3]:
        for hop,context in [(1,.25),(2,.25),(3,.25),(2,0)]:
            result_windows.append(windows(native,c,hop,context))
            save(WORK/'window-results.json',result_windows)
    resampled=[]
    for c in inputs:
        audio=WORK/(c['id']+'-16k.wav')
        conversion=guarded_run(['ffmpeg','-v','error','-nostdin','-y','-threads','1','-filter_threads','1',
                               '-i',c['audio'],'-ac','1','-ar','16000',str(audio)],name='convert-'+c['id'])
        value=align(native,c,name='native-16k-'+c['id'],audio=str(audio))
        value['conversionSeconds']=conversion['seconds']
        value['agreement']=agreement(value['cues'],c['reference'],c['duration'])
        resampled.append(value)
        save(WORK/'resample-results.json',resampled)
        print(value['id'],round(value['seconds'],3),'agreement',round(value['agreement'],3),flush=True)


if __name__=='__main__': main()
