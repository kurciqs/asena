from flask import Flask, request, jsonify, send_from_directory
from flask_cors import CORS
import requests
import os
import json
import base64 
import subprocess
SAVE_DIR = "."

app = Flask(__name__, static_folder="./")
CORS(app)

@app.route("/chat", methods=["POST"])
def chat():
    res = requests.post("http://localhost:1234/v1/chat/completions", json=request.json)
    return jsonify(res.json())

@app.route("/")
def index():
    return send_from_directory(app.static_folder, "index.html")

@app.route("/<path:path>")
def static_files(path):
    return send_from_directory(app.static_folder, path)

@app.route("/status")
def status():
    return "What usually happens when you poke something with a stick? It pokes back. s2e4"
 
@app.route('/save_audio', methods=['POST'])
def save_audio():
    data = request.json
    if not data or 'audio' not in data or 'filename' not in data:
        return jsonify({'error': 'Missing audio or filename'}), 400
    
    audio_b64 = data['audio']
    filename = data['filename']
    
    try:
        audio_bytes = base64.b64decode(audio_b64)
    except Exception as e:
        return jsonify({'error': f'Invalid base64 data: {str(e)}'}), 400
    
    # Save directory (make sure this exists or create it) 
    file_path = SAVE_DIR + filename    
    with open(file_path, 'wb') as f:
        f.write(audio_bytes)
   
    return jsonify({'status': 'success', 'saved_to': file_path})

@app.route('/save_json', methods=['POST'])
def save_json():
    data = request.json
    if not data or 'json_data' not in data or 'filename' not in data:
        return jsonify({'error': 'Missing json_data or filename'}), 400
    
    json_data = data['json_data']
    filename = data['filename']
    
    file_path = SAVE_DIR + filename

    try:
        with open(file_path, 'w', encoding='utf-8') as f:
            json.dump(json_data, f, indent=2, ensure_ascii=False)
    except Exception as e:
        print(str(e))
        return jsonify({'error': f'Failed to save JSON: {str(e)}'}), 500
    
    return jsonify({'status': 'success', 'saved_to': file_path})

@app.route('/get_visemes', methods=['POST'])
def get_visemes():
    data = request.json
    filepath = SAVE_DIR + data['filepath']
    if not filepath or not os.path.exists(filepath):
        return jsonify({'error': 'Invalid or missing file path'}), 400

    # first convert to correct format
    conv_path = filepath.replace(".wav", "_conv.wav")
    # dawg if this subprocess fails, you don't even deserve to know it's so obscure
    subprocess.run([
        "ffmpeg", "-y", "-i", filepath,
        "-ac", "1", "-ar", "44100", "-sample_fmt", "s16",
        conv_path
    ], capture_output=True, text=True)

    result = subprocess.run(
        ["../rhubarb/rhubarb", conv_path, "-f", "json"],
        capture_output=True,
        text=True
    )
    if result.returncode != 0:
        return jsonify({'error': 'Rhubarb failed', 'stderr': result.stderr}), 500

    output = json.loads(result.stdout)
    out_data = {
        "visemes": output.get("mouthCues", []),
        "soundFile" : data['filepath'] # this one without the dot i guess
    }
    
    animation_path = SAVE_DIR + data['animation_data']
    if not animation_path or not os.path.exists(animation_path):
        return jsonify({'error': 'Invalid or missing animation data path'}), 400

    try:
        with open(animation_path, "w") as f:
            json.dump(out_data, f)
    except Exception as e:
        print(f"ERROR: Failed to export animation data: {e}")

    # return, not sure what to do with it though since it's already saved
    return jsonify({'mouthCues': output.get("mouthCues", [])})

if __name__ == "__main__":
    app.run(port=58762, debug=True)
