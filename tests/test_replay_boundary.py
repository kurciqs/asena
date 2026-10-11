"""The replay server must not reach inference, subprocesses, or write endpoints."""
import unittest
from unittest.mock import patch

import server


class ReplayBoundaryTests(unittest.TestCase):
    def setUp(self):
        self.mode = patch.object(server, "RUNTIME_MODE", "replay")
        self.mode.start()
        self.addCleanup(self.mode.stop)
        self.client = server.app.test_client()

    def test_backend_and_write_calls_are_blocked_before_handlers(self):
        with patch.object(server.requests, "post", side_effect=AssertionError("network called")) as network, \
                patch.object(server.subprocess, "run", side_effect=AssertionError("subprocess called")) as process, \
                patch("builtins.open", side_effect=AssertionError("file opened")) as opened:
            for route in ("/chat", "/tts", "/get_visemes", "/save_audio", "/save_json", "/unknown"):
                for method in ("POST", "PUT", "PATCH", "DELETE"):
                    with self.subTest(route=route, method=method):
                        response = self.client.open(route, method=method, json={})
                        self.assertEqual(response.status_code, 403)
            network.assert_not_called()
            process.assert_not_called()
            opened.assert_not_called()

    def test_real_memory_is_not_read_by_replay(self):
        with patch("builtins.open", side_effect=AssertionError("real memory read")):
            for path in ("/data/memory.json", "/src/data/memory.json", "/DATA/memory.json",
                         "/data/./memory.json", "/src/data/../data/memory.json"):
                with self.subTest(path=path):
                    self.assertEqual(self.client.get(path).status_code, 403)

    def test_runtime_and_fixture_assets_are_available(self):
        self.assertEqual(self.client.get("/runtime").json, {"mode": "replay"})
        for path in ("/", "/replay/benchmark.json", "/replay/silence.wav"):
            with self.subTest(path=path):
                response = self.client.get(path)
                self.assertEqual(response.status_code, 200)
                response.close()
        response = self.client.get("/replay/missing-audio.wav")
        self.assertEqual(response.status_code, 404)
        response.close()

    def test_live_mode_keeps_the_existing_proxy(self):
        with patch.object(server, "RUNTIME_MODE", "live"), patch.object(server.requests, "post") as proxy:
            proxy.return_value.json.return_value = {"choices": []}
            response = self.client.post("/chat", json={"model": "test-model"})
            self.assertEqual(response.status_code, 200)
            proxy.assert_called_once_with(server.LMS_API, json={"model": "test-model"})


if __name__ == "__main__":
    unittest.main()
