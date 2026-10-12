import mimetypes
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

from flask import Flask, request, jsonify, send_from_directory, abort, Response
import requests
import json
import subprocess
import posixpath
import threading
ALIGNMENT_LOCK = threading.Lock()
import context_budget as budget
import private_storage as storage
from alignment import align_audio
from kokoro_stream import StreamRegistry, SpeechStream
from pathlib import Path
from service_contracts import ServiceError, require_payload, proxy_json, validate_chat_response, validate_tts_response, validate_visemes

from config import STATIC_DIR, RHUBARB, RHUBARB_THREADS, ALIGNMENT_CACHE_ENTRIES, FFMPEG, LMS_API, KOKORO_API, RUNTIME_MODE, HOST, PORT, PROCESS_TIMEOUT, CHAT_MODEL, VOICE, LIP_SYNC, ASSETS, SPEECH_STREAMING, SPEECH_PROFILE, SPEECH_SOURCE
from recorded_speech import RecordedSpeechStream
SPEECH_STREAMS = StreamRegistry(RecordedSpeechStream if SPEECH_SOURCE=='recorded' else SpeechStream)

app = Flask(__name__, static_folder=None)
app.config["MAX_CONTENT_LENGTH"] = 24 * 1024 * 1024

@app.errorhandler(ServiceError)
def service_error(error):
    return jsonify({"error": str(error), "retryable": error.status >= 500}), error.status

@app.errorhandler(subprocess.TimeoutExpired)
def process_timeout(error):
    return jsonify({"error": "Audio alignment timed out; retry or use audio without lip sync.", "retryable": True}), 504

@app.errorhandler(FileNotFoundError)
def process_missing(error):
    return jsonify({"error": "A required local file or speech tool is unavailable.", "retryable": True}), 503

@app.errorhandler(OSError)
def storage_failure(error):
    return jsonify({"error": "Local storage could not be read or saved. Existing memories have been preserved.", "retryable": True}), 503

@app.errorhandler(413)
def oversized_request(error):
    return jsonify({"error": "Request is too large.", "retryable": False}), 413

@app.before_request
def enforce_replay_boundary():
    # The website is loopback-only. Reject foreign origins and DNS-rebinding hosts.
    if request.host.split(':')[0] not in ('127.0.0.1', 'localhost'):
        return jsonify({'error': 'This server only accepts local website hosts.'}), 403
    origin = request.headers.get('Origin')
    if origin and origin != request.host_url.rstrip('/'):
        return jsonify({'error': 'Cross-origin requests are not allowed.'}), 403
    if request.headers.get('Sec-Fetch-Site') == 'cross-site':
        return jsonify({'error': 'Cross-site requests are not allowed.'}), 403

    if RUNTIME_MODE == "replay" and request.method not in ("GET", "HEAD", "OPTIONS"):
        return jsonify({"error": "Offline replay blocks backend calls and server writes."}), 403
    replay_path = posixpath.normpath(request.path).lower()
    if RUNTIME_MODE == 'preview' and (replay_path in ('/chat','/tts','/get_visemes','/save_audio','/save_json') or
            replay_path.startswith('/api/') and replay_path not in ('/api/speech/stream','/api/speech/progress','/api/speech/cancel')):
        return jsonify({'error':'Scripted preview blocks language models and private data. Only its selected speech source is enabled.'}),403
    if RUNTIME_MODE == "replay" and (replay_path in (
        "/chat", "/tts", "/get_visemes", "/save_audio", "/save_json"
    ) or replay_path.startswith(("/data/", "/src/data/", "/api/"))):
        return jsonify({"error": "This resource is unavailable in offline replay."}), 403

@app.route("/runtime")
def runtime():
    return jsonify({"mode": RUNTIME_MODE, "budget": budget.public_config(), "chatModel": CHAT_MODEL, "voice": VOICE, "lipSync": LIP_SYNC, "assets": ASSETS, "speechStreaming": SPEECH_STREAMING, "speechProfile": SPEECH_PROFILE,"speechSource":SPEECH_SOURCE})

@app.errorhandler(404)
def page_not_found(e):
    return send_from_directory(STATIC_DIR, "404.html"), 404

@app.route("/chat", methods=["POST"])
def chat():
    payload = budget.enforce_budget(require_payload(request.get_json(silent=True), 'chat'))
    return jsonify(validate_chat_response(proxy_json(LMS_API, payload, 'LM Studio')))

@app.route("/tts", methods=["POST"])
def tts():
    payload = require_payload(request.get_json(silent=True), 'tts')
    return jsonify(validate_tts_response(proxy_json(KOKORO_API, payload, 'Kokoro')))

@app.route('/api/speech/stream', methods=['POST'])
def streamed_speech():
    if not SPEECH_STREAMING:
        raise ServiceError('Streaming speech is disabled in this server configuration.', 403)
    if not ALIGNMENT_LOCK.acquire(blocking=False):
        raise ServiceError('Speech alignment is busy. Retry shortly.', 409)
    try:
        stream = SPEECH_STREAMS.reserve(request.get_json(silent=True), endpoint=KOKORO_API, binary=RHUBARB)
    except Exception:
        ALIGNMENT_LOCK.release(); raise
    released=threading.Event();release_lock=threading.Lock()
    def release():
        with release_lock:
            if released.is_set():return
            released.set()
        stream.cancel()
        if stream.worker: stream.worker.join()
        SPEECH_STREAMS.release(stream,on_release=ALIGNMENT_LOCK.release)
    def generate():
        try:
            for event in stream.iterate(): yield json.dumps(event, separators=(',', ':'))+'\n'
        finally:
            stream.cancel(); threading.Thread(target=release, daemon=True).start()
    response=Response(generate(), mimetype='application/x-ndjson')
    response.call_on_close(lambda:threading.Thread(target=release,daemon=True).start())
    return response

@app.route('/api/speech/progress', methods=['POST'])
@app.route('/api/speech/cancel', methods=['POST'])
def speech_stream_control():
    try: return jsonify(SPEECH_STREAMS.control(request.get_json(silent=True), cancel=request.path.endswith('cancel')))
    except ValueError as error: raise ServiceError(str(error), 400) from error

@app.route("/")
def serve_index():
    return send_from_directory(STATIC_DIR, "index.html")

@app.route("/<path:path>")
def static_files(path):
    relative = path[4:] if path.startswith('src/') else path
    normalized = posixpath.normpath(relative).lower()
    if normalized == 'data' or normalized.startswith(('data/', '.runtime/')):
        return jsonify({'error': 'Private data is not a static resource.'}), 403
    resolved = (STATIC_DIR / relative).resolve()
    resolved_parts = resolved.relative_to(STATIC_DIR).parts if resolved.is_relative_to(STATIC_DIR) else ()
    if resolved_parts and resolved_parts[0].lower() == 'data':
        return jsonify({'error': 'Private data is not a static resource.'}), 403
    if not resolved.is_relative_to(STATIC_DIR) or any(part.startswith('.') for part in Path(relative).parts):
        abort(404)
    return send_from_directory(STATIC_DIR, relative)

@app.route("/status")
def status():
    return "What usually happens when you poke something with a stick? It pokes back. 2:4"
 
@app.route('/save_audio', methods=['POST'])
@app.route('/save_json', methods=['POST'])
def obsolete_write():
    return jsonify({'error': 'Client file paths are no longer supported. Use the private resource APIs.'}), 410

@app.route('/api/memories', methods=['GET', 'PUT'])
def memory_resource():
    if request.method == 'GET':
        return jsonify({'memories': storage.read_memories()})
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or set(data) != {'memories'}:
        raise ServiceError('Expected only a memories list; filenames are not accepted.',400)
    storage.save_memories(data['memories'])
    return jsonify({'status': 'saved', 'count': len(data['memories'])})

@app.route('/api/audio', methods=['POST'])
def audio_resource():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or set(data) != {'audio'}:
        raise ServiceError('Expected only WAV audio; filenames are not accepted.',400)
    return jsonify({'audio_id': storage.store_audio(data['audio'])}), 201

@app.route('/api/audio/<audio_id>', methods=['DELETE'])
def release_audio(audio_id):
    storage.delete_audio(audio_id)
    return jsonify({'status': 'released'})

@app.route('/get_visemes', methods=['POST'])
def get_visemes():
    data = request.get_json(silent=True)
    if not isinstance(data, dict) or 'audio_id' not in data or set(data)-{'audio_id','spoken_text'}:
        raise ServiceError('Expected a server-issued audio resource ID and optional spoken text.',400)
    text=data.get('spoken_text','')
    try:
        valid_text=isinstance(text,str) and len(text.encode('utf-8'))<=20000 and '\0' not in text
    except UnicodeError:
        valid_text=False
    if not valid_text:
        raise ServiceError('Spoken text must be a string of at most 20,000 UTF-8 bytes.',400)
    filepath = storage.audio_path(data['audio_id'])
    if not ALIGNMENT_LOCK.acquire(blocking=False):
        raise ServiceError('Audio alignment is busy. Retry shortly, or use audio without lip sync.',503)
    try:
        return jsonify(align_audio(filepath,text=text,binary=RHUBARB,ffmpeg=FFMPEG,
                       threads=RHUBARB_THREADS,timeout=PROCESS_TIMEOUT,
                       cache_folder=storage.DATA_DIR/'alignment-cache',cache_entries=ALIGNMENT_CACHE_ENTRIES))
    finally:
        storage.delete_audio(data['audio_id'])
        ALIGNMENT_LOCK.release()

@app.after_request
def private_response_headers(response):
    if request.path.startswith(('/api/', '/chat', '/tts', '/get_visemes')):
        response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response

if __name__ == '__main__':
    app.run(host=HOST, port=PORT, debug=False, use_reloader=False)
