# Installation

## Fixture-only website

Use Python 3.12 (tested 3.12.9), create a project environment, and install `requirements.txt` as shown in the [README](README.md). `requirements.in` pins direct dependencies; `requirements.txt` also pins the resolved transitive dependencies. A disposable clean environment with these versions passes the backend tests. The old global environment is not upgraded automatically. Flask-CORS is no longer needed.

Run `python scripts/check_setup.py --mode replay` with that environment. It reads configuration, package versions, indexes and fixture paths; it makes no network calls, launches no executables, and writes no user data. Missing optional FBX files are warnings; the included avatar remains usable in its rest pose. Missing required assets are failures.

Start with `ASENA_MODE=replay ASENA_PORT=3001 python server.py`. Replay is also the safe default. The website listens only on `127.0.0.1`; Flask debug and automatic reloading are disabled in all modes. Restart it after backend changes. Browser imports use Three.js 0.176.0, fflate 0.7.4, and three-vrm 3.5.5, with exact URLs in `src/index.html`. The Google font remains external. A fully disconnected browser needs a separate vendoring pass.

## Startup and rendering

Settings are available immediately. Text input and Send stay disabled until avatar startup and initial prompt/memory loading settle. Prompt and memory reads have an eight-second limit; missing prompt uses a visible basic fallback, unreadable memory disables Save, and renderer failure leaves text chat usable. Invalid runtime/replay configuration still disables chat rather than falling through to live services.

Use **settings → Rendering** to choose Balanced (60 fps, pixel ratio at most 1.5), Low power (30 fps, ratio at most 1), or High detail (60 fps, ratio at most 2). High detail is the default; saved choices take precedence. Shadows are off by default and separately selectable. Hidden tabs stop drawing; canvas sizing runs on changes. Startup loads the avatar and idle only; other gestures load/cache before first use. Dictionary data loads only for a dictionary-mode speech turn. First-use gestures can add preparation time; compare saved scenes before choosing quality permanently.

The [full TODO 02–10 report](docs/implementation-report-02-10.md) contains the commit trail, regression diagnosis, measured work reductions, limitations and walkthrough.

## Configuration

All runtime options are in `config.py`; `.env.example` documents them. Export values in your shell: the server does **not** automatically load `.env`. Relative filesystem defaults resolve against the checkout, so the server can be launched from another directory. `/runtime` shares only the mode, model key, voice, lip-sync choice, budgets and public asset URLs with the browser; upstream endpoints and private paths stay server-side.

| Variable | Default | Purpose |
| --- | --- | --- |
| `ASENA_MODE` | `replay` | `replay`, scripted `preview`, or explicitly prepared `live` |
| `ASENA_PORT` | `3001` | Local website port |
| `ASENA_HOST` | `127.0.0.1` | Only supported bind address |
| `ASENA_CHAT_MODEL` | `qwen3.5-2b` | Exact model identifier configured in LM Studio |
| `ASENA_LMS_API` | `http://127.0.0.1:1234/v1/chat/completions` | OpenAI-compatible chat endpoint |
| `ASENA_KOKORO_API` | `http://127.0.0.1:8880/dev/captioned_speech` | Captioned WAV/streaming PCM endpoint; current Docker test maps it to port 8881 |
| `ASENA_SPEECH_STREAMING` | `0` (`1` in preview) | Regional PCM/Rhubarb playback; explicit opt-in for live chat |
| `ASENA_SPEECH_PROFILE` | `stable-122` | Shared sentence mode / 1-second opening / 2-second regions / 2-second minimum reserve |
| `ASENA_SPEECH_SOURCE` | `kokoro` (`recorded` in preview) | Saved PCM/cues in scripted preview, actual provider in live chat |
| `ASENA_PREVIEW_KOKORO` | `0` | Explicitly offer live speech in preview; never starts services |
| `ASENA_VOICE` | `af_heart` | Initial live voice; the existing picker can change it |
| `ASENA_LIP_SYNC` | `rhubarb` | `rhubarb` or approximate `dictionary` fallback |
| `ASENA_DATA_DIR` | `<checkout>/.runtime` | Private data directory outside `src/` |
| `ASENA_RHUBARB` | Verified project-local ARM64 tool when available; otherwise `<checkout-parent>/rhubarb/rhubarb` | Explicit executable override |
| `ASENA_RHUBARB_THREADS` | `2` | Maximum requested recognition workers, bounded to 1–4 |
| `ASENA_ALIGNMENT_CACHE_ENTRIES` | `64` | Private exact-input cue cache, 0–64 entries; zero disables it |
| `ASENA_FFMPEG` | `ffmpeg` | Executable name on PATH or absolute path |
| `ASENA_CONTEXT_CAPACITY` | `8192` | Must be at or below the context configured in the loaded model |
| `ASENA_OUTPUT_RESERVE` | `512` | Maximum output tokens per request |
| `ASENA_PROFILE_BUDGET` | `4096` | Conservative byte-token bound for base prompt + profile |
| `ASENA_MEMORY_BUDGET` | `1024` | Bound for selected complete memory strings |
| `ASENA_CONNECT_TIMEOUT` / `ASENA_READ_TIMEOUT` | `3` / `30` | Upstream socket timeout seconds |
| `ASENA_SERVICE_DEADLINE` | `90` | Total response deadline checked between chunks |
| `ASENA_ALIGNMENT_TIMEOUT` | `30` | Shared total deadline for conversion and Rhubarb |

The context meter reports a conservative NFC UTF-8 byte bound, plus template/message overhead, with output capacity reserved. It does not present those bytes as measured model tokens. It keeps complete recent turns and selects recent complete memories; old displayed messages and stored memories are not deleted. Oversized profiles/newest turns are rejected visibly. A different tokenizer/template requires verification. Separate extraction usage cannot overwrite dialogue usage. Live/model-specific tuning remains pending.

## Scripted main-interface preview

`ASENA_MODE=preview ASENA_PORT=3001 python3 server.py` starts the original chat with scripted replies and saved PCM/Rhubarb cues through the current streaming player. LLM and private-memory routes are blocked. Test profile/memories remain isolated in browser storage. Preview starts no speech or model service.

To offer an already authorized running Kokoro, add `ASENA_PREVIEW_KOKORO=1` and its endpoint at launch. Select **Live Kokoro + Rhubarb** in Debug; only Play scene generates speech. Source/voice/profile settings are captured per turn. The same panel has collapsible inspection and downloadable component timing/cleanup reports. [Full launch examples and LLM handoff](docs/llm-integration-handoff-2026-10-13.md).

**Move to a fresh chat before live LLM integration**, as requested by Jakub. Read-only file/preflight checks are not model activation or live acceptance.

## Live services — manual preparation only

The website does not start, load, or install these services. Prepare RAM and launch them manually only when ready. Replay development needs none of them. The following version records are from the documented dependency/download/recording sessions; the stabilization tests do not run inference.

1. **LM Studio:** the downloaded model is [unsloth/Qwen3.5-2B-GGUF](https://huggingface.co/unsloth/Qwen3.5-2B-GGUF), `Qwen3.5-2B-Q4_K_M.gguf`, verified revision/hash in `runtime-lock.json`. Set its served identifier to `qwen3.5-2b`, or override `ASENA_CHAT_MODEL` with the exact served ID. Configure text-only use and context capacity explicitly. Prepare reasoning mode in LM Studio; hiding reasoning after generation does not eliminate its cost. The recorded app/runtime versions are in the lock; this model has not been live-tested by stabilization. Avoid just-in-time auto-loading if you want explicit control over RAM. [LM Studio local server documentation](https://lmstudio.ai/docs/developer/core/server).
2. **Kokoro:** pinned CPU image `ghcr.io/remsky/kokoro-fastapi-cpu:v0.9.0`, Linux ARM64 on this Mac, with registry/platform digests in the lock. It produced the saved `af_heart` fixtures. Configure one worker on the constrained laptop. Its captioned complete response must contain WAV `audio` and word `timestamps`. Missing timing allows neutral playback; invalid audio keeps the text and offers Retry. The complete-WAV rollback is retained; opt-in streaming uses captioned NDJSON/PCM and bounded regional Rhubarb. Docker GPU images target NVIDIA CUDA; Apple GPU acceleration needs a separately tested native MPS setup. [Pinned upstream release](https://github.com/remsky/Kokoro-FastAPI/releases/tag/v0.9.0), [earlier resource findings](docs/runtime-downloads-and-streaming-2026-10-11.md).
3. **Rhubarb/ffmpeg:** Rhubarb 1.14.0 and ffmpeg 7.1.1. A native ARM64 Release build is now installed privately on this Mac and preferred when its executable matches the unmodified-build manifest; the original x86_64 executable remains available as fallback. [Optimization measurements and streaming strategies](docs/rhubarb-optimization-2026-10-12.md). Download Rhubarb from its [official release](https://github.com/DanielSWolf/rhubarb-lip-sync/releases/tag/v1.14.0), extract it, and set `ASENA_RHUBARB`; put ffmpeg on PATH or set its absolute path. `check_setup.py --mode live` checks executable presence without running them. Dictionary mode uses the existing CMU file if available and is an approximate fallback, not equivalent timing quality.

When services are already prepared and coordinated in the new chat, start the website explicitly with `ASENA_MODE=live ASENA_SPEECH_STREAMING=1 python server.py` (set the Kokoro endpoint to its actual host port). It uses the same model for dialogue and existing memory extraction. Combined live memory/latency/quality are still unmeasured. First test each prepared service separately before attempting simultaneous workloads.

## Optional native Rhubarb build on Apple Silicon

The website never compiles or downloads tools automatically. Existing CMake, Ninja, Clang and Python are required. This sequence obtains official pinned source and Boost headers in the ignored removable experiment directory, builds with one job and a process-tree memory guard, and installs only the verified standard binary/resources under `.runtime/tools/`:

```sh
mkdir -p .runtime/rhubarb-optimization
git -c filter.lfs.process= -c filter.lfs.required=false -c filter.lfs.smudge=cat clone --depth 1 --branch v1.14.0 https://github.com/DanielSWolf/rhubarb-lip-sync.git .runtime/rhubarb-optimization/upstream
curl --fail --location https://archives.boost.io/release/1.85.0/source/boost_1_85_0.tar.bz2 --output .runtime/rhubarb-optimization/boost_1_85_0.tar.bz2
python scripts/rhubarb_benchmark.py guard --name native-build-supervisor --timeout 1100 -- python scripts/build_native_rhubarb.py
python scripts/install_native_rhubarb.py
```

The LFS override leaves unrelated upstream test recordings as pointers; the executable's speech-recognition resources are ordinary source files. The builder verifies the Boost archive hash and omits unrelated plugin extras. It does not start speech generation. Permission to inspect its child processes is required for the memory guard. Restart the website after installing or changing backend configuration. Set `ASENA_RHUBARB` to the original executable to compare or revert. Removing experiment/build caches later does not remove the separately installed runtime tool.

Alignment cache entries live privately under `<ASENA_DATA_DIR>/alignment-cache/`, contain mouth cues only, and are capped at 512 KiB each. They are distinct from companion memories. Repeated audio can reuse cues only with matching transcript, tool/resources, thread setting and conversion configuration. Regional streaming is implemented with the shared profile; resident decoder reuse remains an isolated optimization candidate.

## Assets, data and verification

See [assets.md](docs/assets.md) for Mixamo FBX settings and automatic browser retargeting. No Blender conversion is required by this pipeline. The included avatar and saved fixtures suffice for a clean replay checkout; gestures are optional.

Live memories remain a string-list JSON at `.runtime/memory.json`, with manual Save, private permissions and atomic writes. A legacy `src/data/memory.json` is imported once on the first live read if the private file does not exist. A malformed/oversized file is preserved for repair. Old client-path write endpoints no longer work. Private temporary WAV resources use random IDs, are removed after alignment/Stop, and have expiry/capacity backstops.

Run lightweight regressions from the checkout (Node 23.9.0 was used; Node 22.7+ supports these ESM tests without a package build):

```sh
python -m unittest discover -s tests -p 'test_*.py' -v
npm ci --ignore-scripts
npm test
python scripts/check_setup.py --mode replay
```

The npm dependencies are small, pinned animation libraries used only by tests; the website still uses its pinned browser imports. Tests exercise real VRM morph bindings and Three.js bone blending, mock service calls/processes, and use recorded media. They never start models or Docker. `scripts/record_replay_audio.py capture --confirm-generation` is a separate explicit speech-generation action and is not part of setup or testing. Avoid invoking it until the computer is prepared and generation is intended.
