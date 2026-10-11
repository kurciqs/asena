# Runtime downloads and speech recommendation — 11 October 2026

This is the download-stage snapshot. A later, explicitly authorized replay recording session is documented in [Kokoro recording findings](kokoro-recording-run-2026-10-11.md); Kokoro and Docker were stopped again after capturing the seven clips.

The requested downloads are complete. I did not open LM Studio, load Qwen, or start any Kokoro container or speech model. Docker Desktop's engine was started only to fetch the image. The existing Kokoro container was checked before and after the download and remained stopped; its restart policy is `no`. No containers were running when the download finished, and Docker Desktop was then stopped again successfully. A final process check found LM Studio open independently of these download actions; I did not stop or alter it. A read-only GET of its model inventory confirmed that Qwen was discovered and had no loaded instances. The listed embedding model also had no loaded instances.

## Download record

### Qwen3.5-2B

- Publisher/repository: [unsloth/Qwen3.5-2B-GGUF](https://huggingface.co/unsloth/Qwen3.5-2B-GGUF).
- File: `Qwen3.5-2B-Q4_K_M.gguf`, **1,280,835,840 bytes** (1.28 GB).
- Installed location: `/Users/kurciqs/.lmstudio/models/unsloth/Qwen3.5-2B-GGUF/Qwen3.5-2B-Q4_K_M.gguf`.
- Publisher revision: `f6d5376be1edb4d416d56da11e5397a961aca8ae`.
- SHA-256: `aaf42c8b7c3cab2bf3d69c355048d4a0ee9973d48f16c731c0520ee914699223`.
- Downloaded byte count and SHA-256 matched the publisher's file metadata before the partial download was renamed into place. This verifies the download, not inference compatibility or performance.
- LM Studio's existing server reports model key `qwen3.5-2b`, GGUF Q4_K_M, and `loaded_instances: []`. It advertises reasoning on/off and currently lists the default as on. No load or inference endpoint was called.

Asena still requests the old OpenHermes identifier in [main.js](/Users/kurciqs/Documents/coding/sayuri/asena/src/main.js:141). Downloading Qwen does not change that setting. Configure the chosen model identifier, reasoning mode, and context budget before a later live session; no runtime code or LM Studio settings were changed here.

### Kokoro-FastAPI

- Downloaded image: `ghcr.io/remsky/kokoro-fastapi-cpu:v0.9.0`, selecting **linux/arm64**.
- Published multi-platform digest: `sha256:ee3111d6a2c903ed62f3b4fa19543c6901205ed39fce3c177e895b34a8386b9c`.
- ARM64 manifest digest: `sha256:73940a712af75ff5f2558e5aafe71624b03bbd64c9dc60061794ae468969cc20`.
- Compressed image layers total approximately **1.426 GB**. This is not the expanded disk footprint or RAM requirement.
- Image build date from local metadata: **10 September 2026**. Tag, architecture, and digest were verified after a successful pull. [Published CPU image](https://github.com/remsky/Kokoro-FastAPI/pkgs/container/kokoro-fastapi-cpu).

The older `latest` image and container `nostalgic_leavitt` were preserved. That container still refers to image `sha256:c8812546d358cbfd6a5c4087a28795b2b001d8e32d7a322eedd246e6bc13cb55`, built **18 June 2025**, and is stopped. Pulling v0.9.0 does not upgrade an existing container automatically. Its old application version remains unidentified; the build date alone does not establish a release number.

## Native Kokoro storage

The neural model is small; its software environment contributes considerably to total storage. No native environment was installed to obtain these figures.

| Part | Evidence / size |
| --- | --- |
| Kokoro v1.0 weights | **327,212,226 bytes** |
| All 54 upstream voice packs | **28,264,709 bytes** total; `af_heart` alone is about 0.52 MB |
| Model plus all voices | **355.5 MB** |
| Default native dependency artifacts | Static macOS ARM64 / Python 3.12 analysis of v0.9.0's lockfile found **133 packages**, with approximately **245 MB** of known compressed artifacts, excluding one artifact whose size was absent |
| Measured expanded dependency wheels | ZIP directory metadata for **128 wheels** totals **824.4 MB**, including approximately **328.6 MB** for PyTorch |
| Remaining unmeasured storage | English spaCy model, four source-built packages, bytecode, Python/runtime tooling, source checkout, caches, and any additional language dictionaries |

Model and voice figures come from the [official model repository's file metadata](https://huggingface.co/hexgrad/Kokoro-82M/tree/main). Dependency selection came from the [pinned upstream lockfile](https://raw.githubusercontent.com/remsky/Kokoro-FastAPI/v0.9.0/uv.lock). Expanded wheel sizes were calculated from ZIP metadata fetched through HTTP Range requests. No native Kokoro environment was installed, and no model code was imported or executed.

**Planning estimate: reserve approximately 2–3 GB for a native setup and ordinary caches.** The directly measured files already account for about 1.18 GB before the remaining items. This is a storage estimate, not an exact installation measurement or a RAM estimate. Extra language dictionaries, duplicate caches/environments, and build tools can increase it.

## Is native Apple GPU acceleration worth it?

It is worth a later controlled comparison, especially for memory headroom. A native service avoids the Linux VM and can use Apple's GPU through PyTorch MPS; upstream already provides a [macOS MPS launcher](https://github.com/remsky/Kokoro-FastAPI/blob/v0.9.0/start-gpu_mac.sh). [PyTorch MPS documentation](https://docs.pytorch.org/docs/2.8/notes/mps.html).

The configured Docker VM limit is 3 GiB, but that is a cap, not a measured saving from switching to native. MPS and the language model would share this Mac's unified memory and GPU resources. The launcher enables CPU fallback for unsupported operations, so GPU acceleration does not guarantee better latency for short sentences. Native CPU should also be compared: removing VM overhead may be valuable even without MPS.

Use the same API, voice, and text across Docker CPU, native CPU, and native MPS. Measure warm and cold first-audio latency, generation relative to playback duration, peak memory, swap, and combined LLM/TTS behavior. These tests remain deferred; this request authorized fetching files and research, not running Kokoro or Qwen.

## Streaming and lip sync

The current application waits for a complete LLM answer, a complete Kokoro response, and complete Rhubarb analysis before speech. Its [TTS proxy](/Users/kurciqs/Documents/coding/sayuri/asena/server.py:37) buffers JSON, and [the browser](/Users/kurciqs/Documents/coding/sayuri/asena/src/main.js:163) requests `stream: false`. Changing that flag alone will not implement streaming.

Kokoro v0.9.0's `/dev/captioned_speech` can stream framed JSON carrying base64 audio and word timestamps. Its stream is encoded incrementally: a transport chunk is not necessarily a complete independently playable WAV file. A browser decoder/queue must handle framing, format metadata, buffering, playback time, cancellation, and partial failures. [Captioned-speech documentation](https://github.com/remsky/Kokoro-FastAPI/blob/v0.9.0/README.md#captions), [audio writer source](https://github.com/remsky/Kokoro-FastAPI/blob/v0.9.0/api/src/services/streaming_audio_writer.py).

Rhubarb analyzes complete audio files. Sentence-sized audio files let us retain that approach while avoiding analysis of the entire reply before playback. Supplying the matching sentence as a dialogue file may improve recognition; chunk-boundary mouth transitions still need evaluation. [Rhubarb documentation](https://github.com/DanielSWolf/rhubarb-lip-sync/blob/v1.14.0/README.adoc).

My recommendation is to **keep Docker as the first baseline and build a phrase playback queue before changing the backend**:

1. Start with recorded/synthetic fixtures and one playback clock. Ensure stopping discards queued audio and mouth cues.
2. Split text at sensible sentence/clause boundaries, keeping the first phrase short. Generate its audio, run Rhubarb on that complete phrase, and begin playback while preparing a bounded amount of subsequent audio. Use unique files per turn/phrase, serialize expensive generation work, and cap Rhubarb's worker threads rather than using its default of all CPU cores.
3. This gives us sentence batches with good lip sync. It is a distinct step from implementing Kokoro's continuous HTTP audio stream; each phrase can initially use an ordinary complete WAV response.
4. **Superseded by the later user-requested decision gate:** the original faster-mode proposal used word timing with approximate phoneme/viseme mapping. Jakub previously found dictionary articulation weaker than Rhubarb. Keep it as a candidate; select and visually validate a mouth-motion path under TODO 11a before implementing speech streaming. The [expanded research and architecture plan](speech-and-lip-sync-plan-2026-10-11.md) compares neural alternatives and newer local TTS.
5. Add LLM text streaming into the same queue later, buffering enough text for natural prosody and withholding incomplete action tags or reasoning from speech. Compare Docker CPU and native backends only after the queue and timing contract work.

Whether phrase batching is fast enough depends on measured generation and Rhubarb throughput. Frequent tiny phrases add processing overhead and can harm intonation; look-ahead only helps if preparation keeps pace with playback. Native acceleration and streaming are independent choices, so a later native service can reuse the same queue and lip-sync modes.

No streaming, model-selection, speech, or animation code was changed during this task.
