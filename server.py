import mimetypes
mimetypes.add_type("application/javascript", ".js")
mimetypes.add_type("text/css", ".css")

from flask import Flask, request, jsonify, send_from_directory, abort
import requests
import os
import json
import subprocess
import posixpath
import threading
ALIGNMENT_LOCK = threading.Lock()
import context_budget as budget
import private_storage as storage
from pathlib import Path
from service_contracts import ServiceError, require_payload, proxy_json, validate_chat_response, validate_tts_response, validate_visemes

STATIC_DIR = Path(__file__).resolve().parent / "src"
RHUBARB = "../rhubarb/rhubarb"
LMS_API = "http://localhost:1234/v1/chat/completions"
# outsource kokoro to a local stronger machine, improves performance drastically, you could even run the whole server there instead of on the laptop, with that performance kokoro is basically faster than lms. 
#KOKORO_API = "http://192.168.1.110:8880/dev/captioned_speech"
KOKORO_API = "http://localhost:8880/dev/captioned_speech"

RUNTIME_MODE = os.environ.get("ASENA_MODE", "live")
if RUNTIME_MODE not in ("live", "replay"):
    raise RuntimeError("ASENA_MODE must be live or replay; refusing an ambiguous launch")

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
    if RUNTIME_MODE == "replay" and (replay_path in (
        "/chat", "/tts", "/get_visemes", "/save_audio", "/save_json"
    ) or replay_path.startswith(("/data/", "/src/data/", "/api/"))):
        return jsonify({"error": "This resource is unavailable in offline replay."}), 403

@app.route("/runtime")
def runtime():
    return jsonify({"mode": RUNTIME_MODE, "budget": budget.public_config()})

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
    if resolved.is_relative_to(STATIC_DIR) and resolved.relative_to(STATIC_DIR).parts[0].lower() == 'data':
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
    if not isinstance(data, dict) or set(data) != {'audio_id'}:
        raise ServiceError('Expected a server-issued audio resource ID.',400)
    filepath = storage.audio_path(data['audio_id'])
    conv_path = filepath.with_name('aligned.wav')
    if not ALIGNMENT_LOCK.acquire(blocking=False):
        raise ServiceError('Audio alignment is busy. Retry shortly, or use audio without lip sync.',503)
    try:
        result = subprocess.run([
            'ffmpeg', '-threads', '1', '-nostdin', '-y', '-i', str(filepath),
            '-ac', '1', '-ar', '44100', '-sample_fmt', 's16', str(conv_path)
        ], capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            raise ServiceError('Audio conversion failed. Check the WAV and ffmpeg, then retry.')
        result = subprocess.run([RHUBARB, str(conv_path), '-f', 'json'],
                                capture_output=True, text=True, timeout=30)
        if result.returncode != 0:
            raise ServiceError('Rhubarb alignment failed. Check the tool, then retry.')
        try:
            output = json.loads(result.stdout)
            if not isinstance(output,dict): raise ValueError('Expected object')
        except ValueError as error:
            raise ServiceError('Rhubarb returned invalid JSON.') from error
        return jsonify({'visemes': validate_visemes(output.get('mouthCues', []))})
    finally:
        storage.delete_audio(data['audio_id'])
        ALIGNMENT_LOCK.release()

@app.after_request
def private_response_headers(response):
    if request.path.startswith(('/api/', '/chat', '/tts', '/get_visemes')):
        response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Content-Type-Options'] = 'nosniff'
    return response

if __name__ == "__main__":    
    app.run(host="127.0.0.1", port=int(os.environ.get("ASENA_PORT", "3000")),
            debug=RUNTIME_MODE == "live", use_reloader=RUNTIME_MODE == "live")
