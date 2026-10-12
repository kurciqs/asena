# Asena

Asena is a customizable local companion: LM Studio dialogue → Kokoro speech → Rhubarb mouth cues → a Three.js/VRM avatar. Choose a name, personality, relationship notes, preferences and friendly / affectionate / intimate closeness in **customize**. Those settings become model instructions; the selected model determines their quality.

The current milestone stabilizes the existing companion loop. Recorded replay works without loading AI models. Live Qwen dialogue and the combined workload still need a separately prepared test on the laptop. Streaming, natural motion and long-term memory improvements remain in [TODO.md](TODO.md); the audio-clock scheduler is implemented. See the [stabilization review](docs/stabilization-02-09.md) for changes and limitations.

## Start safely

Python 3.12 is the tested baseline. From the checkout:

```sh
python3 -m venv .venv
.venv/bin/python -m pip install -r requirements.txt
.venv/bin/python scripts/check_setup.py --mode replay
ASENA_MODE=replay ASENA_PORT=3001 .venv/bin/python server.py
```

Open [Asena](http://127.0.0.1:3001/). This starts only the website. The replay banner says **AI services blocked**. Five scripted scenes use saved Kokoro speech, existing gestures, and a test preference recalled after Save and reload. Stop cancels the turn; the collapsible inspector exposes its data. Test profile/memory stay separate from live data.

During speech, **Pause / Resume** holds or continues the voice and its mouth, emotion and gesture timeline together. Stop also works while paused. The [audio-clock scheduler report](docs/audio-clock-11.md) explains the bounded segment queue and verification; captioned Kokoro streaming is now available as an opt-in path, with [live measurements and limitations](docs/kokoro-streaming-2026-10-12.md).

Drag the chat by its header, or hide it and use **Open chat** to restore it. Settings and Debug share a switchable tools panel; Debug is available in replay mode. **S** opens settings, **C** shows/hides chat, and **Esc** closes tools. Expand **Context estimate** to see instructions, memories, conversation and padding. See the [UI cleanup review](docs/ui-cleanup-10a.md) for screenshots and manual checks.

Use **Settings → Display → Rendering quality** for Balanced, Low power or High detail. High detail is the default; saved choices take precedence. Low power caps the avatar at 30 fps and pixel ratio 1. Idle is the only startup gesture; others load/cache when needed. Hidden tabs stop drawing. Text input opens after avatar and data startup settle. Settings remain available during startup; avatar failure permits text-only use afterward.

Three.js and VRM libraries currently use CDN resources, so the avatar needs internet or previously cached resources. The UI uses system fonts. “Offline replay” means no AI-service calls, not a fully disconnected browser. Frontend package URLs are exactly pinned; full vendoring has not been selected. The [full TODO 02–10 report](docs/implementation-report-02-10.md) records changes, regression fixes, verification and review steps.

## Setup and development

- [Installation and configuration](INSTALLATION.md): replay, manually prepared live services, environment variables, verification.
- [Avatar and animation assets](docs/assets.md): included avatar, Mixamo export/retargeting, missing-asset fallback.
- [Replay guide](docs/replay-mode.md): scenes, inspection, failures, synthetic memory and recordings.
- [Backlog](TODO.md), [architecture review](docs/architecture-health-check-2026-10-11.md), [benchmark](docs/companion-benchmark.md).
- [Speech and lip-sync decision plan](docs/speech-and-lip-sync-plan-2026-10-11.md): realistic live mouth-motion alternatives, local TTS shortlist, optional cloud comparisons and evaluation required before streaming changes.
- [Kokoro startup improvements](docs/kokoro-startup-2026-10-12.md): shorter phrase requests, visible waiting progress, and live browser comparisons of aggressive versus smoother startup.
- [Lip-sync studio](http://localhost:3001/lip-sync-samples.html): compare fifteen mouth-motion methods on the same three saved Kokoro lines and Asena's actual face; [preparation, measurements and limitations](docs/lip-sync-audition-2026-10-12.md). Kokoro and Rhubarb are selected; live streaming/resource acceptance remains open.
- [Rhubarb optimization report](docs/rhubarb-optimization-2026-10-12.md): native Apple Silicon speedups, measured strategy tradeoffs, resource limits and the plan for captioned Kokoro streaming. The studio now displays Rhubarb preparation times.
- [Streaming fixes and intonation diagnosis](docs/streaming-fixes-and-prosody-2026-10-13.md): caption-tail recovery, named listening samples, direct saved playback, shared JSON trees, memory-pressure evidence and next speedups.
- [Saved-audio streaming test](docs/rhubarb-saved-stream-test-2026-10-12.md): original simulation evidence with bounded queues and cancellation; the current browser saved mode replays stored voice/cues directly, while the offline CLI retains the paced simulation. The separate test page starts with `python3 scripts/rhubarb_stream_probe.py --serve`; it runs no Kokoro or language model. The optional `--allow-kokoro` mode runs fixed-text live trials only after the user has prepared and started Kokoro. [Actual streaming results and main-companion configuration](docs/kokoro-streaming-2026-10-12.md).
- [Runtime lock](runtime-lock.json): dependency/backend versions and model file provenance. Runtime inspection records are snapshots, not live performance guarantees.

Memory remains a list of strings with manual Save. Live memory and temporary audio now live under ignored `.runtime/`, outside public assets. Existing local data has been preserved. Back up that directory yourself. Replay fixtures are public synthetic examples; do not add personal recordings there. Earlier Git history may contain the formerly tracked memory file.

The website binds to `127.0.0.1`, rejects foreign origins, and does not support remote binding. If you later expose it remotely, add authentication/TLS deliberately. Configuring an inference endpoint on another private computer does not expose the website itself. Opening the site never starts LM Studio, Docker or Kokoro.

The included `asena_sfw.vrm` is the author's VRoid Studio model, permitted for use by the project author. Mixamo FBX files are user-supplied and are not redistributed in this repository.

![Asena](res/image.png)
