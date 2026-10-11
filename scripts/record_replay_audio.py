"""Explicit recording step, then offline alignment. Never starts Docker or an LLM."""
import argparse
import base64
import hashlib
import json
import math
import re
import subprocess
import time
import urllib.parse
import urllib.request
import wave
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "src" / "replay" / "benchmark.json"
VOICE = "af_heart"


def write_json(path, value):
    temporary = path.with_suffix(".json.part")
    temporary.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")
    temporary.replace(path)


def scenes(fixture):
    names = ["intro", "teasing", "disagreement", "emotes", "memory"]
    if len(fixture["turns"]) != len(names):
        raise ValueError("This recorder expects the agreed five-turn benchmark")
    return list(zip(names, fixture["turns"])) + [
        ("recall", fixture["recall"]), ("recall-empty", fixture["recall"]["withoutMemory"])
    ]


def spoken(reply):
    return re.sub(r"\s+", " ", re.sub(r"\*[^*]+\*", "", reply)).strip()


def capture(args):
    if not args.confirm_generation:
        raise ValueError("Recording invokes Kokoro: explicitly supply --confirm-generation")
    url = urllib.parse.urlsplit(args.url)
    if url.scheme != "http" or url.hostname not in ("localhost", "127.0.0.1", "::1"):
        raise ValueError("Only an explicitly started local Kokoro service is supported")
    stage = args.stage_dir
    stage.mkdir(parents=True, exist_ok=True)
    fixture = json.loads(MANIFEST.read_text())
    with urllib.request.urlopen(args.url + "/openapi.json", timeout=10) as response:
        version = json.load(response)["info"]["version"]
    report_path = stage / "capture.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {"clips": {}}
    report.update({"backendVersion": version, "voice": VOICE, "speed": 1.0,
                   "capturedAt": datetime.now(timezone.utc).isoformat()})
    for name, turn in scenes(fixture):
        text = spoken(turn["reply"])
        if not text or len(text) > 300:
            raise ValueError("Only short, nonempty benchmark lines may be recorded")
        existing = report["clips"].get(name)
        audio_path = stage / (name + "-raw.wav")
        if existing and existing["text"] == text and audio_path.exists() and \
                hashlib.sha256(audio_path.read_bytes()).hexdigest() == existing["sha256"]:
            print(f"Reusing captured {name}", flush=True)
            continue
        response_path = stage / (name + "-response.json")
        if response_path.exists():
            cached = json.loads(response_path.read_text())
            if cached["text"] != text:
                raise ValueError("Cached response text changed; use a new staging directory")
            data, elapsed = cached["response"], cached["generationSeconds"]
        else:
            request = urllib.request.Request(args.url + "/dev/captioned_speech", method="POST",
                data=json.dumps({"model": "kokoro", "input": text, "voice": VOICE, "speed": 1.0,
                                 "response_format": "wav", "stream": False}).encode(),
                headers={"Content-Type": "application/json"})
            started = time.perf_counter()
            with urllib.request.urlopen(request, timeout=180) as response:
                payload = response.read(8_000_001)
            elapsed = round(time.perf_counter() - started, 4)
            if len(payload) > 8_000_000:
                raise ValueError("Unexpectedly large Kokoro response")
            data = json.loads(payload)
            write_json(response_path, {"text": text, "generationSeconds": elapsed, "response": data})
        audio = base64.b64decode(data["audio"], validate=True)
        if audio[:4] != b"RIFF" or audio[8:12] != b"WAVE":
            raise ValueError("Kokoro did not return WAV audio")
        timestamps = data["timestamps"]
        if not timestamps:
            raise ValueError("Kokoro returned no word timestamps")
        raw_timestamps = [dict(stamp) for stamp in timestamps]
        for stamp in timestamps:
            if not isinstance(stamp["word"], str) or not all(
                math.isfinite(stamp[key]) for key in ("start_time", "end_time")
            ) or not -0.03 <= stamp["start_time"] <= stamp["end_time"] or stamp["end_time"] < 0:
                raise ValueError(f"Invalid Kokoro word timestamp: {stamp!r}")
            # Silence trimming can leave the first token a few milliseconds before zero.
            stamp["start_time"] = max(0, stamp["start_time"])
        audio_path.write_bytes(audio)
        report["clips"][name] = {"text": text, "timestamps": timestamps, "rawTimestamps": raw_timestamps,
            "generationSeconds": elapsed, "rawBytes": len(audio),
            "sha256": hashlib.sha256(audio).hexdigest()}
        write_json(report_path, report)
        print(json.dumps({"clip": name, "generationSeconds": elapsed,
                          "words": len(timestamps), "bytes": len(audio)}), flush=True)
    print("Capture complete. Stop Kokoro before running the align step.", flush=True)


def align(args):
    stage = args.stage_dir
    report = json.loads((stage / "capture.json").read_text())
    fixture = json.loads(MANIFEST.read_text())
    result_dir = stage / "aligned"
    result_dir.mkdir(exist_ok=True)
    rhubarb_version = subprocess.run([str(args.rhubarb), "--version"], check=True,
                                    capture_output=True, text=True, timeout=10).stdout.strip()
    for name, turn in scenes(fixture):
        clip = report["clips"][name]
        if spoken(turn["reply"]) != clip["text"]:
            raise ValueError("Benchmark changed since capture; refusing mismatched audio")
        raw = stage / (name + "-raw.wav")
        if hashlib.sha256(raw.read_bytes()).hexdigest() != clip["sha256"]:
            raise ValueError("Captured audio checksum mismatch")
        audio = result_dir / (name + ".wav")
        subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-y", "-threads", "1",
                        "-i", str(raw), "-ac", "1", "-ar", "44100", "-c:a", "pcm_s16le", str(audio)],
                       check=True, capture_output=True, timeout=30)
        with wave.open(str(audio), "rb") as wav:
            duration = wav.getnframes() / wav.getframerate()
            sample_rate = wav.getframerate()
        if not 0 < duration <= 30 or any(stamp["end_time"] > duration + 0.05 for stamp in clip["timestamps"]):
            raise ValueError("Audio duration and word timestamps disagree")
        # The trimmed waveform can finish a few milliseconds before the last token.
        # Retain raw timings in the recording report and bound playback timings.
        for stamp in clip["timestamps"]:
            stamp["start_time"] = min(stamp["start_time"], duration)
            stamp["end_time"] = min(stamp["end_time"], duration)
        dialogue = stage / (name + ".txt")
        dialogue.write_text(clip["text"])
        started = time.perf_counter()
        process = subprocess.run([str(args.rhubarb), str(audio), "-f", "json", "-d", str(dialogue),
                                  "--threads", "1", "-q"], check=True, capture_output=True,
                                 text=True, timeout=90)
        elapsed = time.perf_counter() - started
        cues = json.loads(process.stdout)["mouthCues"]
        for cue in cues:
            if cue["value"] not in "ABCDEFGHX" or not 0 <= cue["start"] <= cue["end"] <= duration + 0.03:
                raise ValueError("Invalid Rhubarb mouth cue")
            cue["end"] = min(cue["end"], duration)
        if not cues:
            raise ValueError("Rhubarb returned no mouth cues")
        turn["speech"] = {"audio": "/replay/" + name + ".wav", "timestamps": clip["timestamps"],
            "source": "kokoro", "voice": report["voice"], "speed": report["speed"],
            "spokenText": clip["text"], "duration": round(duration, 6), "sampleRate": sample_rate,
            "backendVersion": report["backendVersion"]}
        turn["visemes"] = cues
        turn["alignment"] = {"source": "rhubarb", "version": rhubarb_version, "threads": 1,
                             "dialogueProvided": True}
        clip.update({"duration": round(duration, 6), "alignmentSeconds": round(elapsed, 4),
                     "realTimeFactor": round(clip["generationSeconds"] / duration, 4) if clip["generationSeconds"] is not None else None,
                     "savedBytes": audio.stat().st_size, "mouthCues": len(cues)})
        clip["timingAdjustments"] = [
            {"index": i, "original": raw, "playback": bounded}
            for i, (raw, bounded) in enumerate(zip(clip["rawTimestamps"], clip["timestamps"]))
            if raw != bounded
        ]
        print(json.dumps({"clip": name, "duration": round(duration, 3),
                          "alignmentSeconds": round(elapsed, 3), "mouthCues": len(cues)}), flush=True)
    # Publish complete assets before atomically switching the manifest to their paths.
    for audio in result_dir.glob("*.wav"):
        destination = ROOT / "src" / "replay" / audio.name
        temporary = destination.with_suffix(".wav.part")
        temporary.write_bytes(audio.read_bytes())
        temporary.replace(destination)
    fixture["description"] = "Scripted replies; saved Kokoro af_heart audio and word timings; Rhubarb mouth cues. No live generation during replay."
    fixture["recording"] = {"capturedAt": report["capturedAt"], "backendVersion": report["backendVersion"],
                            "voice": report["voice"], "speed": report["speed"], "clips": report["clips"]}
    write_json(MANIFEST, fixture)
    write_json(stage / "capture.json", report)
    print("Published all seven recorded replay clips and matching timing data.", flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("stage", choices=("capture", "align"))
    parser.add_argument("--stage-dir", type=Path, required=True)
    parser.add_argument("--confirm-generation", action="store_true")
    parser.add_argument("--url", default="http://127.0.0.1:8881")
    parser.add_argument("--rhubarb", type=Path, default=ROOT.parent / "rhubarb" / "rhubarb")
    args = parser.parse_args()
    (capture if args.stage == "capture" else align)(args)


if __name__ == "__main__":
    main()
