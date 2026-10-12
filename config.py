"""Single source for local runtime configuration. Importing starts no services."""
import os
import hashlib
import json
import platform
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
STATIC_DIR = ROOT / 'src'

def integer(name, default, minimum=1, maximum=32768):
    try: value=int(os.environ.get(name,str(default)))
    except ValueError as error: raise RuntimeError(f'{name} must be an integer') from error
    if not minimum <= value <= maximum: raise RuntimeError(f'{name} must be in {minimum}..{maximum}')
    return value

def endpoint(name,default):
    value=os.environ.get(name,default)
    parsed=urlsplit(value)
    if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise RuntimeError(f'{name} must be a valid HTTP(S) endpoint without embedded credentials')
    return value

RUNTIME_MODE = os.environ.get('ASENA_MODE','replay')
if RUNTIME_MODE not in ('live','replay'): raise RuntimeError('ASENA_MODE must be live or replay')
HOST = os.environ.get('ASENA_HOST','127.0.0.1')
if HOST != '127.0.0.1': raise RuntimeError('Remote website binding is unsupported; ASENA_HOST must be 127.0.0.1')
PORT = integer('ASENA_PORT',3001,1024,65535)
DATA_DIR = Path(os.environ.get('ASENA_DATA_DIR',str(ROOT/'.runtime'))).expanduser().resolve()
if DATA_DIR.is_relative_to(STATIC_DIR): raise RuntimeError('ASENA_DATA_DIR must be outside public assets')
def default_rhubarb():
    candidate=ROOT/'.runtime/tools/rhubarb-1.14.0-arm64/rhubarb'
    if platform.machine()=='arm64' and candidate.is_file():
        try:
            manifest=json.loads(candidate.with_name('build-manifest.json').read_text())
            if (manifest.get('version')=='1.14.0' and manifest.get('algorithmChanges') is False
                    and hashlib.sha256(candidate.read_bytes()).hexdigest()==manifest.get('binarySha256')
                    and (candidate.parent/'res/sphinx/acoustic-model/mdef').is_file()):
                return candidate
        except (OSError,ValueError,AttributeError): pass
    return ROOT.parent/'rhubarb'/'rhubarb'

RHUBARB = str(Path(os.environ.get('ASENA_RHUBARB') or default_rhubarb()).expanduser().resolve())
RHUBARB_THREADS = integer('ASENA_RHUBARB_THREADS',2,1,4)
ALIGNMENT_CACHE_ENTRIES = integer('ASENA_ALIGNMENT_CACHE_ENTRIES',64,0,64)
FFMPEG = os.environ.get('ASENA_FFMPEG','ffmpeg')
LMS_API = endpoint('ASENA_LMS_API','http://127.0.0.1:1234/v1/chat/completions')
KOKORO_API = endpoint('ASENA_KOKORO_API','http://127.0.0.1:8880/dev/captioned_speech')
CHAT_MODEL = os.environ.get('ASENA_CHAT_MODEL','qwen3.5-2b')
VOICE = os.environ.get('ASENA_VOICE','af_heart')
LIP_SYNC = os.environ.get('ASENA_LIP_SYNC','rhubarb')
SPEECH_STREAMING = os.environ.get('ASENA_SPEECH_STREAMING','0') == '1'
if not CHAT_MODEL or len(CHAT_MODEL)>200: raise RuntimeError('Invalid ASENA_CHAT_MODEL')
if not VOICE or not all(c.isalnum() or c in '_-+' for c in VOICE): raise RuntimeError('Invalid ASENA_VOICE')
if LIP_SYNC not in ('rhubarb','dictionary'): raise RuntimeError('ASENA_LIP_SYNC must be rhubarb or dictionary')
CONTEXT_CAPACITY = integer('ASENA_CONTEXT_CAPACITY',8192,2048)
OUTPUT_RESERVE = integer('ASENA_OUTPUT_RESERVE',512)
PROFILE_BUDGET = integer('ASENA_PROFILE_BUDGET',4096)
MEMORY_BUDGET = integer('ASENA_MEMORY_BUDGET',1024)
TEMPLATE_RESERVE = 256
MESSAGE_OVERHEAD = 64
if OUTPUT_RESERVE + TEMPLATE_RESERVE >= CONTEXT_CAPACITY: raise RuntimeError('Reply reserve exceeds context capacity')
NETWORK_TIMEOUT = (integer('ASENA_CONNECT_TIMEOUT',3,1,30),integer('ASENA_READ_TIMEOUT',30,1,120))
NETWORK_DEADLINE = integer('ASENA_SERVICE_DEADLINE',90,1,300)
PROCESS_TIMEOUT = integer('ASENA_ALIGNMENT_TIMEOUT',30,1,120)
ASSETS = {'modelsIndex':'/vrm_models/models.json','models':'/vrm_models/','animationsIndex':'/animations/animations.json','animations':'/animations/','systemPrompt':'/system_prompt.txt','dictionary':'/dictionary/cmudict.json'}
