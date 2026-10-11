# Offline replay (TODO 01)

Replay runs the current parser, emotion/action mapping, avatar, and animation playback with deterministic substitutes for chat, TTS, and Rhubarb. It uses the [companion benchmark](companion-benchmark.md). No AI service needs to be running.

## Launch

Use the project's existing Python environment with Flask, flask-cors, and requests installed:

```sh
ASENA_MODE=replay ASENA_PORT=3001 python3 server.py
```

Open **http://127.0.0.1:3001/**. The replay banner must say **AI services blocked**. The separate port allows the existing website to remain open. Replay disables Flask debug/reloading and binds to localhost.

`ASENA_MODE=live` (the default) retains the existing live pipeline. An invalid mode refuses to launch. After updating this checkout, restart any older server so it provides the new `/runtime` endpoint; the frontend does not guess a mode if that endpoint is absent.

“Offline” means no AI backend calls. The existing Three.js/VRM libraries and font still come from CDNs unless cached; fully disconnected frontend dependencies belong to TODO 09.

## Use

Wait for the avatar to appear, then press **play scene**. The next benchmark message is filled in automatically after the recorded clip ends. Replies are fixed even if you type a different message or customize the profile; this evaluates the pipeline, not a language model's ability to follow your input.

Use **Settings** or the **S** shortcut (outside text inputs) to open the original animation/model/voice controls. They sit above the replay panel without overlapping it. **Hide debug** folds the replay controls and inspector; **Show debug** restores them. An expanded inspector scrolls within the available space below settings.

The inspector's `animation` field updates when clips load or the selected animation changes, including automatic returns to idle. `currentClip` uses the registered key (`idle`, `wave`, etc.), rather than the generic internal FBX conversion name. `ready` becomes true once all indexed animations finish loading.

After the five-turn showcase, press **Save test memory**, then choose **Recall saved test memory**. Changing scenes reloads the page and clears ordinary chat history. Recall responds with mint tea only if the saved synthetic fact is present in the memory prompt. **Clear test memory** removes only replay memories; **Restart scene** repeats the selected case without removing saved test memory.

**Inspect this turn** shows raw and parsed text, word timestamps, speech voice/version/duration, alignment source, mouth cues, mapped actions/emotions, current animation state, the extracted memory, and the active memory prompt. Objects, arrays, and long strings expand individually; their sizes remain visible while folded. Nested branches are created when opened, and expanded paths stay open across turn updates. **Collapse all** folds the tree again. This makes existing defects observable rather than concealing them with a separate animation implementation. For example, newly extracted memories still await TODO 25's repair before the active prompt refreshes immediately.

The scene selector also provides simulated chat, speech, and alignment failures; a missing WAV; and empty word timestamps. Failures are shown in the panel. A finished or absent fixture cannot trigger live generation. Full cancellation and reliable missing-animation handling remain TODO 02–03.

## Audio and memory isolation

Seven saved Kokoro `af_heart` recordings cover the five showcase turns and both memory-recall variants. They contain 1.85–4.56 seconds of speech each, saved as 44.1 kHz mono PCM WAVs, totaling about 2.05 MB. Word timings come from Kokoro; mouth cues come from Rhubarb using each recording and its dialogue. A silent WAV remains available for explicitly synthetic fixtures. None of these assets invoke inference during replay. Do not place personal recordings in tracked/public fixtures.

The recordings exercise audible playback and actual speech alignment. They do not resolve the existing tag-offset or mouth-channel mapping defects (TODO 04–05), evaluate a live LLM, or establish voice quality across arbitrary dialogue. Version, timings, original timestamps and recording measurements are retained in `benchmark.json`. See the [Kokoro recording findings](kokoro-recording-run-2026-10-11.md).

Replay stores the existing list-of-strings memory format as JSON under the browser key `asena.replay.memories.v1`. Test profile keys also have an `asena.replay.` prefix. It never fetches the real memory file or writes to it. This is a test storage adapter, not a redesign of production persistence. Production disk save/reload still needs its own verification when the relevant stabilization tasks are implemented.

The server rejects mutation requests in replay, blocks chat/TTS/Rhubarb routes, and blocks access to the private data directory. Thus accidental requests to the old pipeline cannot reach inference, subprocess execution, or server writes. The frontend separately selects fixture adapters from the server-provided mode and has no live fallback.

## Fixtures and verification

Edit `src/replay/benchmark.json` for replies, scenarios, audio paths, word timestamps, and mouth cues. Audio paths are constrained to local `/replay/*.wav` fixtures. Missing or invalid fixture data fails closed. Supported injected failure stages are `chat`, `tts`, and `alignment`.

The fixture builder uses no inference or audio tools:

```sh
python3 scripts/build_replay_fixtures.py
```

It retains an existing recorded manifest. To deliberately replace the manifest with silent synthetic fixtures, pass `--synthetic`. Editing recorded dialogue requires matching new audio and timing data; the recorder refuses to align changed text against previously captured clips.

Speech capture is a separate, explicitly authorized operation against an already running local Kokoro service. The script never starts Docker or an LLM:

```sh
python3 scripts/record_replay_audio.py capture --confirm-generation --stage-dir /tmp/asena-new-recording --url http://127.0.0.1:8881
# Stop Kokoro/Docker before doing offline alignment on a constrained machine.
python3 scripts/record_replay_audio.py align --stage-dir /tmp/asena-new-recording
```

Capture caches responses and audio to avoid generating a line twice after an alignment error. Alignment runs one Rhubarb worker, repairs WAV headers through ffmpeg, validates timing bounds, and publishes the complete set. It requires ffmpeg and the existing sibling `rhubarb/rhubarb` executable (override with `--rhubarb`). Run the lightweight checks with:

```sh
python3 -m unittest discover -s tests -p 'test_*.py' -v
node --test tests/replay.test.mjs
```

The server checks mock network calls, subprocesses, and file opens while hitting blocked routes; they also check memory isolation and the live proxy with a mock. The JavaScript checks cover benchmark parsing, failure injection, local audio failures/timeouts, fixture exhaustion, test profile/memory isolation, and memory-dependent recall. They do not load models, generate speech, or invoke Rhubarb.

Verified 11 October 2026: all 13 automated checks passed, including recorded WAV sample content, durations, and timing bounds. In the in-app browser, the five scenes completed, one synthetic preference was saved, and recall after a page reload used that preference with ordinary dialogue history cleared. The chat-failure and missing-WAV cases produced visible errors while preserving usable controls. This establishes replay wiring; it does not close the remaining animation, cancellation, memory-refresh, production persistence, or live-quality tasks.
