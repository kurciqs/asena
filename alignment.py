"""Bounded Rhubarb alignment. No process starts until a live request calls it."""
from functools import lru_cache
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import wave
from service_contracts import ServiceError, validate_visemes

MAX_CACHE_FILE_BYTES = 512 * 1024
CACHE_NAME = re.compile(r'^[0-9a-f]{64}\.json$')


def direct_wave(path):
    try:
        with wave.open(str(path)) as wav:
            return (wav.getnchannels()==1 and wav.getsampwidth()==2
                    and wav.getcomptype()=='NONE' and wav.getframerate()==44100
                    and 0 < wav.getnframes()*2 <= path.stat().st_size-44)
    except (OSError, EOFError, wave.Error):
        return False


@lru_cache(maxsize=4)
def tool_fingerprint(binary, signatures):
    digest = hashlib.sha256(Path(binary).read_bytes())
    for relative, size, modified in signatures:
        digest.update(relative.encode())
        digest.update((Path(binary).parent/relative).read_bytes())
    return digest.hexdigest()


def cache_key(path, text, binary, threads, ffmpeg):
    try:
        tool = Path(binary)
        if not tool.is_file() or not path.is_file(): return None
        files=[tool]+sorted(p for p in (tool.parent/'res/sphinx').rglob('*') if p.is_file())
        signatures=tuple((str(p.relative_to(tool.parent)),p.stat().st_size,p.stat().st_mtime_ns) for p in files)
        fingerprint=tool_fingerprint(str(tool),signatures)
        settings=json.dumps({'schema':1,'tool':fingerprint,'text':text,'threads':threads,
                             'recognizer':'pocketSphinx','shapes':'GHX',
                             'conversion':'mono-pcm16-44100','ffmpeg':ffmpeg},sort_keys=True)
        digest=hashlib.sha256(settings.encode());digest.update(path.read_bytes())
        return digest.hexdigest()
    except OSError:
        return None # Cache availability must not prevent ordinary alignment.


def cached_cues(folder, key):
    if not key: return None
    path=folder/(key+'.json')
    try:
        if path.is_symlink() or path.stat().st_size>MAX_CACHE_FILE_BYTES: return None
        data=json.loads(path.read_text())
        if data.get('schema')!=1: return None
        return validate_visemes(data['visemes'])
    except (OSError, ValueError, KeyError, TypeError, AttributeError, ServiceError):
        return None


def store_cached_cues(folder, key, cues, maximum):
    if not key or maximum==0: return
    body=json.dumps({'schema':1,'visemes':cues}).encode()
    if len(body)>MAX_CACHE_FILE_BYTES: return
    temporary=None
    try:
        folder.mkdir(parents=True,exist_ok=True,mode=0o700);os.chmod(folder,0o700)
        files=sorted((p for p in folder.iterdir() if CACHE_NAME.fullmatch(p.name)
                      and p.is_file() and not p.is_symlink()),key=lambda p:p.stat().st_mtime_ns)
        while len(files)>=maximum: files.pop(0).unlink()
        with tempfile.NamedTemporaryFile(dir=folder,delete=False) as handle:
            temporary=Path(handle.name);handle.write(body)
        os.chmod(temporary,0o600);os.replace(temporary,folder/(key+'.json'));temporary=None
    except OSError:
        pass # Successful mouth data remains usable if optional caching fails.
    finally:
        if temporary:
            try: temporary.unlink(missing_ok=True)
            except OSError: pass


def align_audio(path, *, text, binary, ffmpeg, threads, timeout, cache_folder, cache_entries):
    before=time.monotonic()
    key=cache_key(path,text,binary,threads,ffmpeg) if cache_entries else None
    cached=cached_cues(cache_folder,key)
    if cached is not None:
        return {'visemes':cached,'alignment':{'cached':True,'seconds':time.monotonic()-before,
                'rhubarbSeconds':0,'conversionSeconds':0,'threads':threads,'dialogProvided':bool(text)}}
    def remaining():
        value=timeout-(time.monotonic()-before)
        if value<=0: raise subprocess.TimeoutExpired('audio alignment',timeout)
        return value
    converted=not direct_wave(path)
    conversion_seconds=0
    if converted:
        converted_path=path.with_name('aligned.wav')
        start=time.monotonic()
        result=subprocess.run([ffmpeg,'-threads','1','-filter_threads','1','-nostdin','-y',
                               '-i',str(path),'-ac','1','-ar','44100','-sample_fmt','s16',str(converted_path)],
                              capture_output=True,text=True,timeout=remaining())
        if result.returncode: raise ServiceError('Audio conversion failed. Check the WAV and ffmpeg, then retry.')
        conversion_seconds=time.monotonic()-start
        path=converted_path
    command=[binary,'-f','json','-q','-r','pocketSphinx','--threads',str(threads)]
    if text:
        dialog=path.with_name('dialog.txt')
        dialog.write_text(text,encoding='utf-8');os.chmod(dialog,0o600)
        command+=['-d',str(dialog)]
    command.append(str(path))
    start=time.monotonic()
    result=subprocess.run(command,capture_output=True,text=True,timeout=remaining())
    if result.returncode: raise ServiceError('Rhubarb alignment failed. Check the tool, then retry.')
    rhubarb_seconds=time.monotonic()-start
    try:
        output=json.loads(result.stdout)
        if not isinstance(output,dict): raise ValueError('Expected object')
    except ValueError as error: raise ServiceError('Rhubarb returned invalid JSON.') from error
    cues=validate_visemes(output.get('mouthCues',[]))
    store_cached_cues(cache_folder,key,cues,cache_entries)
    return {'visemes':cues,'alignment':{'cached':False,'seconds':time.monotonic()-before,
            'rhubarbSeconds':rhubarb_seconds,'conversionSeconds':conversion_seconds,
            'inputConverted':converted,'threads':threads,'dialogProvided':bool(text)}}
