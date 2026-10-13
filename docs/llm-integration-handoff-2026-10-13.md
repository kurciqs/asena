# Fresh-thread handoff: live LLM and the main companion

**Start a fresh chat before running or tuning the LLM.** Jakub requested that separation to improve context. Prepare the computer and coordinate model activation there. This work did not load Qwen, call inference, change LM Studio settings, or establish spare RAM for combined inference.

## What is ready

- Original draggable chat, customizable companion, settings/debug drawer, avatar, gestures and private string-list memory remain the main app.
- `stable-122` is the shared speech profile: 1-second opening analysis, 2-second later regions, at least 2 seconds prepared before playback, complete sentences/long clauses for Kokoro requests. Do not tune these timings while diagnosing model behavior.
- Kokoro captioned NDJSON → PCM16 timeline → bounded native Rhubarb regions → shared audible sample clock. Captions are optional performance anchors; Rhubarb generates mouth motion from audio.
- First complete reply is displayed before speech. Every fifth reply's factual extraction runs after speech on a bounded snapshot; a new foreground turn cancels stale extraction and retains pending work for a later drain. Manual Save and the existing data format remain.
- Per-turn reports include first text, parsing, asset preparation, full speech startup breakdown, queue state, memory extraction, failure and resource cleanup. Debug JSON remains collapsible; Download turn report omits PCM and control tokens.
- `ASENA_MODE=preview` blocks LLM/private-memory calls server-side and uses isolated scripted benchmark data. Saved speech goes through the production PCM player without generation or simulated latency. The optional live Kokoro selector changes only speech for the next scene.

## Current local pages and repeatable launches

Main preview: [http://localhost:3001/?replay-case=benchmark](http://localhost:3001/?replay-case=benchmark).
Fixed-text diagnostic: [http://localhost:3002/stream-test.html?source=live](http://localhost:3002/stream-test.html?source=live).
Recheck whether servers/Kokoro are still running; these are not persistent-state guarantees.

Safe main preview (starts only Flask):

```sh
ASENA_MODE=preview ASENA_SPEECH_SOURCE=recorded ASENA_PORT=3001 python3 server.py
```

When Kokoro is already explicitly authorized and prepared, offer it as an optional preview source:

```sh
ASENA_MODE=preview ASENA_SPEECH_SOURCE=recorded ASENA_PREVIEW_KOKORO=1 \
ASENA_KOKORO_API=http://127.0.0.1:8881/dev/captioned_speech \
ASENA_PORT=3001 python3 server.py
```

After coordinating model activation in the new chat, stop only the existing main website and start its live mode. The same UI uses real dialogue and private memories; preview test memories do not migrate:

```sh
ASENA_MODE=live ASENA_SPEECH_STREAMING=1 ASENA_SPEECH_PROFILE=stable-122 \
ASENA_KOKORO_API=http://127.0.0.1:8881/dev/captioned_speech \
ASENA_CHAT_MODEL=qwen3.5-2b ASENA_CONTEXT_CAPACITY=8192 \
ASENA_PORT=3001 python3 server.py
```

The launch does not start/load services. Verify the actual served model identifier and model context before submitting a request. The endpoint defaults to `/v1/chat/completions` on port 1234; configure an override if needed. Environment variables are exported at launch; there is no automatic `.env` loader.

## Model preparation and acceptance, in order

1. Recheck service/container state and host memory/swap. The previous Kokoro budget was two CPUs and 2 GiB on an 8 GiB M3 laptop; it is not a measured combined-workload budget. Avoid automatic model loading and concurrent experiments.
2. The existing `Qwen3.5-2B-Q4_K_M.gguf` download was verified on 13 October: 1,280,835,840 bytes, SHA-256 matching `runtime-lock.json`. [File check](evidence/llm-preparation-file-check-2026-10-13.json). No live compatibility/quality claim follows from that checksum.
3. Coordinate one explicit model load. Confirm the served ID, actual context, output limit and reasoning behavior. Investigate disabling reasoning for conversational latency using the installed LM Studio/runtime's supported controls; don't silently strip a long reasoning trace after paying its generation cost.
4. Start with **one completed short reply**, followed by streamed speech. Verify the model returns a useful short complete opening and sparse valid inline cues. No overlapping token-stream/TTS inference yet.
5. Run introduction, teasing, warm disagreement, nod/shrug and explicit mint-tea memory from [the benchmark](companion-benchmark.md). Check newly accepted facts next turn, then Save/reload recall with ordinary history cleared. Scripted replay cannot establish live persona or extraction accuracy.
6. Capture at least one normal turn and one fifth-turn extraction report, including first text/audio and machine pressure. Exercise Stop before audio, Stop during audio, pause/resume and rapid replacement. Paused streaming still has a three-minute total lifetime; expiry must be visible and return to text/idle.
7. Decide whether LM token streaming is worthwhile only after that baseline. TODO 13a retains incremental parser requirements: only finalized speech segments and validated cue records reach Kokoro; preserve abbreviations/numbers/prosody, bounded queues and cancellation. Measure combined resident memory before overlapping inference.

## Optimization and deferred work

The next likely startup gain is a short complete model opening. Hold the accepted speech profile fixed while comparing it. Resident decoder reuse, lower Kokoro token targets and native MPS are isolated experiments with lifecycle, cue-quality and memory gates. The old comparisons remain available; **do not prune TODO 11b without Jakub's authorization**.

P2 keeps the original companion vision: an editable flirty digital assistant, adjustable closeness, believable reactions and layered gestures. Build those on the current performance clock; do not add another resident classifier or redesign memory as an integration prerequisite. The happy-expression mouth distortion remains visual task 20a.

## Evidence and change trace

[P1 report](p1-main-companion-2026-10-13.md), [preferred live baseline](preferred-speech-profile-2026-10-13.md), [native repeated-turn evidence](evidence/speech-lifetimes-native-2026-10-13.json), [main saved-preview report](evidence/main-preview-turn-2026-10-13.json).

Separate implementation commits: `039bc2c` (13 + memory timing), `3f90f05` (14/main preview), `c21a52d` (15/lifetimes), `2327802` (16/main diagnostics). Final code checks: **63 Python / 82 JavaScript tests**, read-only preview preflight with zero blocking issues. Fixtures, mocks and saved audio do not certify live LLM quality or combined resource capacity.
