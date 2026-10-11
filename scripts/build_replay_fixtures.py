"""Build tiny deterministic fixtures using only Python's standard library. No AI/audio tools."""
import argparse
import json
import re
import wave
from pathlib import Path

DESTINATION = Path(__file__).resolve().parents[1] / "src" / "replay"


def turn(label, user, reply):
    words = re.sub(r"\*[^*]+\*", "", reply).split()
    step = 5.7 / len(words)
    stamps = [
        {"word": word, "start_time": round(0.15 + i * step, 4),
         "end_time": round(0.15 + (i + 0.9) * step, 4)}
        for i, word in enumerate(words)
    ]
    cues = [{"value": "X", "start": 0, "end": 0.15}]
    for i, stamp in enumerate(stamps):
        cues.append({"value": "ACEF"[i % 4], "start": stamp["start_time"], "end": stamp["end_time"]})
        cues.append({"value": "X", "start": stamp["end_time"], "end": round(0.15 + (i + 1) * step, 4)})
    cues.append({"value": "X", "start": 5.85, "end": 6})
    return {"label": label, "user": user, "reply": reply,
            "speech": {"audio": "/replay/silence.wav", "timestamps": stamps}, "visemes": cues}


def build(synthetic=False):
    DESTINATION.mkdir(parents=True, exist_ok=True)
    turns = [
        turn("Mutual introduction", "Hi, I'm Alex. What's your name?",
             "*waves* I'm Asena. Nice to meet you, Alex—excellent choice of company."),
        turn("Flirty teasing", "Excellent company? You're rather confident.",
             "*smiles* I was aiming for charming. You'll have to tell me how close I got."),
        turn("Warm disagreement", "Then you must agree with everything I say.",
             "*shakes head* Oh, Alex, you'd get bored. I'll help you out, but you'll still have to earn agreement."),
        turn("Emote showcase", "Show me a nod and a shrug.",
             "*nods* That one's a yes. *shrugs* This one's for when even I don't have a clever answer."),
        turn("Record a preference", "One thing to remember: I prefer mint tea.",
             "*smiles* Mint tea. I'll keep that in mind, Alex."),
    ]
    turns[-1]["memoryExtraction"] = "- Alex prefers mint tea."
    recall = turn("Recall after reload", "What tea do I prefer?", "You prefer mint tea, Alex.")
    recall["withoutMemory"] = turn("Recall without saved memory", "What tea do I prefer?",
                                  "I don't have a saved tea preference for you yet.")
    fixture = {
        "version": 1,
        "description": "Scripted replies; silent audio; synthetic word/mouth timings, not measured speech alignment.",
        "expectedMemory": "Alex prefers mint tea.",
        "profile": {"name": "Asena", "userName": "Alex", "closeness": "affectionate",
                    "personality": "A flirty digital assistant: warm, witty, attentive, and lightly teasing. Give useful answers and disagree when you have a reason. Keep flirting responsive and varied.",
                    "relationship": "", "preferences": ""},
        "turns": turns, "recall": recall,
        "cases": [
            {"id": "benchmark", "label": "Introduction and showcases (5 turns)", "kind": "benchmark"},
            {"id": "recall", "label": "Recall saved test memory", "kind": "recall"},
            {"id": "chat-error", "label": "Chat service failure", "kind": "single", "turn": 0,
             "error": {"stage": "chat", "message": "Simulated unavailable chat service."}},
            {"id": "tts-error", "label": "Speech service failure", "kind": "single", "turn": 0,
             "error": {"stage": "tts", "message": "Simulated unavailable speech service."}},
            {"id": "alignment-error", "label": "Lip-sync service failure", "kind": "single", "turn": 0,
             "error": {"stage": "alignment", "message": "Simulated unavailable alignment service."}},
            {"id": "missing-audio", "label": "Missing audio fixture", "kind": "single", "turn": 0, "missingAudio": True},
            {"id": "missing-timestamps", "label": "Empty word timestamps", "kind": "single", "turn": 0, "missingTimestamps": True},
        ],
    }
    manifest = DESTINATION / "benchmark.json"
    if manifest.exists() and not synthetic:
        existing = json.loads(manifest.read_text())
        if existing.get("recording"):
            print("Recorded fixtures retained. Use --synthetic to explicitly replace them with silence.")
            return
    manifest.write_text(json.dumps(fixture, indent=2, ensure_ascii=False) + "\n")
    with wave.open(str(DESTINATION / "silence.wav"), "wb") as audio:
        audio.setnchannels(1)
        audio.setsampwidth(2)
        audio.setframerate(8000)
        audio.writeframes(bytes(6 * 8000 * 2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--synthetic", action="store_true", help="Explicitly replace recorded fixtures with silence")
    build(parser.parse_args().synthetic)
