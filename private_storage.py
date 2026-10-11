"""Private local storage, independent of public assets and client file paths."""
import json
import os
from pathlib import Path
import re
import shutil
import tempfile
import threading
import time
import uuid
from service_contracts import ServiceError, decode_wav

from config import ROOT, DATA_DIR
LEGACY_MEMORY = ROOT / 'src/data/memory.json'
LOCK = threading.RLock()
MAX_MEMORY_BYTES = 512 * 1024
MAX_AUDIO_BYTES = 16 * 1024 * 1024
MAX_AUDIO_POOL_BYTES = 64 * 1024 * 1024
AUDIO_TTL = 600
ID_PATTERN = re.compile(r'^[0-9a-f]{32}$')


def validate_memories(value):
    if not isinstance(value, list) or len(value) > 5000 or any(not isinstance(item, str) or len(item) > 2000 for item in value):
        raise ServiceError('Memories must be a list of at most 5000 short strings.',400)
    body = json.dumps(value, ensure_ascii=False, indent=2).encode()
    if len(body) > MAX_MEMORY_BYTES:
        raise ServiceError('Memory file is too large.',413)
    return body


def atomic_write(path, body):
    DATA_DIR.mkdir(parents=True,exist_ok=True,mode=0o700)
    os.chmod(DATA_DIR,0o700)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    os.chmod(path.parent,0o700)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as handle:
            temporary = Path(handle.name)
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        os.chmod(temporary,0o600)
        os.replace(temporary,path)
    finally:
        if temporary and temporary.exists(): temporary.unlink()


def read_memories():
    with LOCK:
        path = DATA_DIR / 'memory.json'
        if not path.exists():
            # Import an old checkout once; replay never invokes this function.
            value = json.loads(LEGACY_MEMORY.read_text()) if LEGACY_MEMORY.exists() else []
            atomic_write(path, validate_memories(value))
        if path.stat().st_size > MAX_MEMORY_BYTES:
            raise ServiceError('Existing memory exceeds the configured limit. Export and reduce it before loading.',413)
        try:
            value = json.loads(path.read_text())
            validate_memories(value)
        except (ValueError, UnicodeError) as error:
            raise ServiceError('Existing memory is unreadable; it has been preserved for repair.',500) from error
        return value


def save_memories(value):
    body = validate_memories(value)
    with LOCK: atomic_write(DATA_DIR / 'memory.json',body)


def audio_path(audio_id):
    if not isinstance(audio_id,str) or not ID_PATTERN.fullmatch(audio_id):
        raise ServiceError('Invalid audio resource ID.',400)
    path = DATA_DIR / 'audio' / audio_id / 'input.wav'
    if not path.is_file(): raise ServiceError('Audio resource expired or is missing. Retry speech generation.',404)
    return path


def delete_audio(audio_id):
    if not isinstance(audio_id,str) or not ID_PATTERN.fullmatch(audio_id):
        raise ServiceError('Invalid audio resource ID.',400)
    with LOCK: shutil.rmtree(DATA_DIR / 'audio' / audio_id,ignore_errors=True)


def store_audio(encoded):
    body = decode_wav(encoded)
    if len(body) > MAX_AUDIO_BYTES: raise ServiceError('Audio is too large.',413)
    with LOCK:
        folder = DATA_DIR / 'audio'
        folder.mkdir(parents=True,exist_ok=True,mode=0o700)
        total, count = 0, 0
        for candidate in folder.iterdir():
            if not candidate.is_dir() or not ID_PATTERN.fullmatch(candidate.name): continue
            if time.time() - candidate.stat().st_mtime > AUDIO_TTL:
                shutil.rmtree(candidate,ignore_errors=True)
            else:
                count += 1
                total += sum(file.stat().st_size for file in candidate.iterdir() if file.is_file())
        if count >= 32 or total + len(body) > MAX_AUDIO_POOL_BYTES:
            raise ServiceError('Temporary audio storage is full. Finish or stop existing turns, then retry.',503)
        audio_id = uuid.uuid4().hex
        atomic_write(folder / audio_id / 'input.wav',body)
        return audio_id
