"""Check saved media and timing bounds without starting any speech service."""
import array
import json
import unittest
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class RecordedAudioTests(unittest.TestCase):
    def test_recordings_have_audible_samples_and_matching_timing(self):
        fixture = json.loads((ROOT / "src/replay/benchmark.json").read_text())
        turns = fixture["turns"] + [fixture["recall"], fixture["recall"]["withoutMemory"]]
        for turn in turns:
            with self.subTest(scene=turn["label"]):
                speech = turn["speech"]
                if speech.get("source") != "kokoro":
                    self.skipTest("Explicit synthetic fixture has no recorded speech")
                path = ROOT / "src" / speech["audio"].lstrip("/")
                with wave.open(str(path), "rb") as audio:
                    self.assertEqual(audio.getnchannels(), 1)
                    self.assertEqual(audio.getsampwidth(), 2)
                    self.assertEqual(audio.getframerate(), speech["sampleRate"])
                    duration = audio.getnframes() / audio.getframerate()
                    samples = array.array("h", audio.readframes(audio.getnframes()))
                self.assertAlmostEqual(duration, speech["duration"], places=5)
                self.assertGreater(max(abs(sample) for sample in samples), 1000)
                self.assertGreater(sum(sample * sample for sample in samples) / len(samples), 10000)
                self.assertTrue(speech["timestamps"])
                self.assertTrue(turn["visemes"])
                self.assertEqual(turn["alignment"]["source"], "rhubarb")
                for stamp in speech["timestamps"]:
                    self.assertGreaterEqual(stamp["start_time"], 0)
                    self.assertGreaterEqual(stamp["end_time"], stamp["start_time"])
                    self.assertLessEqual(stamp["end_time"], duration)
                for cue in turn["visemes"]:
                    self.assertGreaterEqual(cue["start"], 0)
                    self.assertGreaterEqual(cue["end"], cue["start"])
                    self.assertLessEqual(cue["end"], duration)
