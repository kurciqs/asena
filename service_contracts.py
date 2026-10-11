"""Bounded local-service contracts. Tests replace all network/process calls."""
import base64
import json
import math
import struct
import time
import requests

MAX_RESPONSE_BYTES = 24 * 1024 * 1024
from config import NETWORK_TIMEOUT, NETWORK_DEADLINE


class ServiceError(Exception):
    def __init__(self, message, status=502):
        super().__init__(message)
        self.status = status


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def require_payload(payload, kind):
    if not isinstance(payload, dict):
        raise ServiceError("Expected a JSON object.", 400)
    if kind == 'chat':
        if not isinstance(payload.get('model'), str) or not 1 <= len(payload['model']) <= 200:
            raise ServiceError("Choose a valid chat model.", 400)
        messages = payload.get('messages')
        if not isinstance(messages, list) or not 1 <= len(messages) <= 1000:
            raise ServiceError("Chat messages must be a nonempty list.", 400)
        for message in messages:
            if not isinstance(message, dict) or message.get('role') not in ('system', 'user', 'assistant') or not isinstance(message.get('content'), str) or len(message['content']) > 100000:
                raise ServiceError("Invalid chat message.", 400)
        for key, low, high in (('temperature', 0, 2), ('top_p', 0, 1), ('max_tokens', 1, 32768)):
            if key in payload and (not finite(payload[key]) or not low <= payload[key] <= high or (key == 'max_tokens' and not isinstance(payload[key], int))):
                raise ServiceError(f"Invalid {key}.", 400)
        return {key: payload[key] for key in ('model', 'messages', 'temperature', 'top_p', 'max_tokens') if key in payload}
    if not isinstance(payload.get('input'), str) or not 1 <= len(payload['input'].strip()) <= 12000:
        raise ServiceError("Speech text must contain 1–12000 characters.", 400)
    voice = payload.get('voice')
    if not isinstance(voice, str) or not 1 <= len(voice) <= 100 or not all(c.isalnum() or c in '_-+' for c in voice):
        raise ServiceError("Invalid voice.", 400)
    speed = payload.get('speed', 1)
    if not finite(speed) or not 0.5 <= speed <= 2:
        raise ServiceError("Invalid speech speed.", 400)
    if payload.get('stream', False) is not False or payload.get('response_format', 'wav') != 'wav':
        raise ServiceError("This speech path requires a complete WAV response.", 400)
    return {'model': 'kokoro', 'input': payload['input'], 'voice': voice, 'speed': speed, 'response_format': 'wav', 'stream': False}


def proxy_json(url, payload, service):
    started = time.monotonic()
    try:
        with requests.post(url, json=payload, timeout=NETWORK_TIMEOUT, stream=True) as response:
            if not 200 <= response.status_code < 300:
                # Preserve the service status without exposing its private response body.
                raise ServiceError(f"{service} returned HTTP {response.status_code}. Check the service, then retry.", response.status_code)
            body = bytearray()
            for chunk in response.iter_content(65536):
                body.extend(chunk)
                if len(body) > MAX_RESPONSE_BYTES:
                    raise ServiceError(f"{service} response was too large.")
                if time.monotonic() - started > NETWORK_DEADLINE:
                    raise ServiceError(f"{service} exceeded its deadline. Retry when it is ready.", 504)
            result = json.loads(body)
            if not isinstance(result, dict):
                raise ValueError('Expected object')
            return result
    except requests.Timeout as error:
        raise ServiceError(f"{service} timed out. Retry when it is ready.", 504) from error
    except requests.RequestException as error:
        raise ServiceError(f"{service} is unavailable. Start it manually when ready, then retry.", 503) from error
    except (ValueError, UnicodeError) as error:
        raise ServiceError(f"{service} returned invalid JSON.") from error


def validate_chat_response(result):
    try:
        text = result['choices'][0]['message']['content']
        if not isinstance(text, str) or not text.strip() or len(text) > 100000:
            raise ValueError()
    except (KeyError, IndexError, TypeError, ValueError) as error:
        raise ServiceError('LM Studio returned an empty or invalid reply. Retry the request.') from error
    return result


def decode_wav(audio):
    if not isinstance(audio, str) or len(audio) > MAX_RESPONSE_BYTES:
        raise ServiceError('Invalid or oversized WAV audio.', 400)
    try:
        blob = base64.b64decode(audio, validate=True)
    except (ValueError, TypeError) as error:
        raise ServiceError('Invalid base64 audio.', 400) from error
    if len(blob) < 44 or blob[:4] != b'RIFF' or blob[8:12] != b'WAVE':
        raise ServiceError('Expected WAV audio.', 400)
    offset, format_info, audio_size = 12, None, None
    while offset + 8 <= len(blob):
        kind, size = blob[offset:offset+4], struct.unpack_from('<I',blob,offset+4)[0]
        if kind == b'fmt ' and 16 <= size <= len(blob)-offset-8:
            format_info = struct.unpack_from('<HHIIHH',blob,offset+8)
        if kind == b'data':
            audio_size = min(size,len(blob)-offset-8)
            break
        offset += 8 + size + size % 2
    if format_info is None or audio_size is None:
        raise ServiceError('WAV format or audio data is missing.',400)
    encoding, channels, rate, byte_rate, block, bits = format_info
    if encoding != 1 or channels not in (1,2) or bits != 16 or not 8000 <= rate <= 192000 or block != channels * 2 or byte_rate != rate * block or audio_size < block or audio_size % block or audio_size / byte_rate > 600:
        raise ServiceError('Expected a bounded PCM16 WAV recording.',400)
    return blob


def normalize_timestamps(words):
    if not isinstance(words, list) or len(words) > 20000:
        raise ValueError('Invalid timestamps')
    output = []
    previous = 0
    for word in words:
        if not isinstance(word, dict) or not isinstance(word.get('word'), str) or not word['word'] or not finite(word.get('start_time')) or not finite(word.get('end_time')):
            raise ValueError('Invalid word')
        start, end = word['start_time'], word['end_time']
        # Kokoro may put its initial token a few milliseconds before the WAV origin.
        if start < -0.1 or end < start or max(0, start) < previous or end > 600:
            raise ValueError('Invalid word range')
        start, end = max(0, start), max(0, end)
        output.append({'word': word['word'], 'start_time': start, 'end_time': end})
        previous = start
    return output


def validate_tts_response(result):
    try:
        decode_wav(result.get('audio'))
    except ServiceError as error:
        raise ServiceError('Kokoro returned invalid WAV audio. The text reply is still available.') from error
    try:
        result['timestamps'] = normalize_timestamps(result.get('timestamps'))
    except ValueError:
        result['timestamps'] = []
        result['warnings'] = ['Word timing unavailable; anchored emotions and gestures will be skipped.']
    return result


def validate_visemes(cues):
    if not isinstance(cues, list) or len(cues) > 20000:
        raise ServiceError('Rhubarb returned invalid mouth cues.')
    previous = 0
    for cue in cues:
        if not isinstance(cue, dict) or cue.get('value') not in ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'X') or not finite(cue.get('start')) or not finite(cue.get('end')) or cue['start'] < previous or cue['end'] < cue['start'] or cue['end'] > 600:
            raise ServiceError('Rhubarb returned invalid mouth cues.')
        previous = cue['start']
    return cues
