# Kokoro recording run — 11 October 2026

The user authorized a temporary Kokoro run to supply audio for TODO 01's replay tool. Seven clips are now saved locally, alongside Kokoro word timings and Rhubarb mouth cues. Replay needs no running speech service. No LLM was loaded or invoked by this work.

## Installed version and run conditions

| Item | Observed value |
|---|---|
| Image | `ghcr.io/remsky/kokoro-fastapi-cpu:v0.9.0` |
| Local image ID | `sha256:ee3111d6a2c903ed62f3b4fa19543c6901205ed39fce3c177e895b34a8386b9c` |
| Image creation label | `2026-09-10T04:36:27Z` |
| Image source revision | `404d122e847569012bd6a6afe36f1c3a5e1c66b7` |
| OpenAPI version | `0.9.0` |
| Model reported at startup | `kokoro_v1`, CPU |
| Voice / speed | `af_heart` / `1.0` |
| Runtime voice inventory banner | 72 voice packs loaded |
| Architecture | Linux arm64 image on Apple M3 |
| Container limits | Two CPU cores; 2 GiB RAM; 2 GiB memory-plus-swap limit |
| Thread settings | `OMP_NUM_THREADS=2`, `MKL_NUM_THREADS=2`, tokenizer parallelism disabled |
| Temporary binding | `127.0.0.1:8881` → container `8880` |
| Restart policy | `no` |

The existing old container was left stopped. The temporary container exited normally (`ExitCode=0`, `OOMKilled=false`); Docker Desktop was stopped afterward, before Rhubarb ran. The temporary stopped container remains named `asena-replay-audio-20261011`, so inspect it later only when Docker is deliberately started. The earlier dependency/download documents describe the state before this authorized execution.

The upstream [v0.9.0 release](https://github.com/remsky/Kokoro-FastAPI/releases/tag/v0.9.0), marked latest when checked, matches this revision. It lists improved normalization and a streaming cleanup fix for client disconnects. Those features were not exercised here. The package/API version and the underlying Kokoro model version are separate identifiers.

## Measured short-clip results

Each request used `/dev/captioned_speech`, `model="kokoro"`, WAV output, and `stream=false`. Capture was sequential. HTTP elapsed time includes the completed local response; it excludes startup and Rhubarb. These are six warm, short English requests, with no competing LLM inference. They do not establish cold-start latency, sustained peak memory, streaming first-audio latency, or performance with an LLM running.

| Clip | Saved audio duration | Kokoro request | Request/audio ratio | Rhubarb alignment | Mouth cues |
|---|---:|---:|---:|---:|---:|
| Introduction | 3.863 s | Not retained | — | 4.184 s | 24 |
| Teasing | 3.743 s | 2.112 s | 0.564 | 4.614 s | 27 |
| Disagreement | 4.562 s | 2.197 s | 0.482 | 4.941 s | 31 |
| Emotes | 4.182 s | 2.051 s | 0.490 | 4.491 s | 26 |
| Memory recording | 2.565 s | 1.475 s | 0.575 | 3.281 s | 15 |
| Recall with memory | 1.849 s | 0.987 s | 0.534 | 2.130 s | 13 |
| Recall without memory | 2.524 s | 1.306 s | 0.517 | 3.313 s | 19 |

The introduction was generated twice while investigating timestamp validation; its second response was retained and reused, but its HTTP elapsed time was not persisted. It is excluded from the six-request aggregate. No other clip was regenerated, and no separate inference benchmark was run. The service also performs its own startup warmup; its log reported **3.098 seconds**, which is not total Docker startup time.

The six timed requests took **10.126 seconds** for **19.425 seconds** of saved speech: a duration-weighted ratio of **0.521**. Here CPU synthesis produced audio faster than playback. Rhubarb's single-worker alignment was slower than synthesis on these samples.

Docker snapshots showed **1.269 GiB** after warmup, **1.361 GiB** after the introduction, and **1.511 GiB / 2 GiB**, with **137.71% CPU**, during the remaining batch. These are sparse container readings, not a measured peak or the full Mac footprint. Docker's VM and desktop overhead are additional. No OOM event was reported.

## API and timing findings

The observed non-streaming response contains base64 WAV data and `timestamps` with `word`, `start_time`, and `end_time`. This matches the [documented captioned-speech contract](https://github.com/remsky/Kokoro-FastAPI/blob/v0.9.0/README.md#captioned-speech).

Important findings from these actual responses:

- Punctuation is returned as separate tokens, including commas, full stops, and the em dash. Consumers cannot assume one token per whitespace-separated word. The existing action/emotion offset code still needs TODO 04.
- Four clips began with slightly negative timing values, down to −12.08 ms. Some final tokens exceeded the trimmed waveform by up to 34.24 ms. The recorder accepts only small boundary discrepancies (30 ms at the start, 50 ms at the end), bounds playback timings to the actual clip, and retains raw timings and every adjustment in `benchmark.json`.
- The returned WAVs had streaming-style size placeholders: Python's WAV reader inferred a huge duration from the original header. ffmpeg rebuilt them as ordinary WAV files before browser playback and Rhubarb. The published files have verified frame counts and durations.
- Raw audio was 24 kHz. Published replay audio is 44.1 kHz mono 16-bit PCM to match the existing alignment path. Resampling changes neither the speech content nor intended cue time scale.
- Rhubarb 1.14.0 ran with the exact spoken dialogue and one worker, after Docker stopped. Its cues are audio-derived; the VRM mouth-channel mapping remains a separate TODO 05 defect.

All seven published WAVs together use **2,054,496 bytes** (about 2.05 MB). Original responses and run logs are staged in `/tmp/asena-replay-speech-20261011` and `/tmp/asena-kokoro-recording.log`; these temporary files are not durable project artifacts. Published recordings, raw timestamps and measurements live under `src/replay/`.

## Implications for the next implementation steps

1. **Keep Docker CPU for the first live stabilization pass.** This limited run gives a reasonable baseline for short replies; switching engines now is not necessary to make replay useful. Enforce lifecycle and request limits before judging performance with chat inference.
2. **Measure alignment separately.** Full utterance Rhubarb adds several seconds here. Consider sentence-sized audio/alignment batches, keeping all word and mouth cues on a shared playback timeline, when TODO 12 is implemented. A separate continuous lip-sync method can be evaluated later. This is a proposed strategy, not a tested streaming result.
3. **Validate streaming framing and cancellation before adopting it.** Upstream documents captioned audio streaming, but this batch used complete responses. A streaming request alone does not make Asena's current buffering frontend stream. Test captured protocol fixtures, timestamp offsets, partial errors, audio headers, and disconnect behavior before another model run.
4. **Native MPS remains a later comparison.** The [upstream Apple Silicon instructions](https://github.com/remsky/Kokoro-FastAPI/blob/v0.9.0/README.md#get-started) support native execution through UV and `start-gpu_mac.sh`; Docker on this Mac uses CPU. Native execution could remove Docker VM overhead and use the Apple GPU, but its speed and memory benefit are unmeasured here. The previous [native disk estimate](runtime-downloads-and-streaming-2026-10-11.md) remains an estimate; no native environment was installed or tested.

The fixed text and voice let us compare later pipeline improvements using the same recordings. They do not demonstrate a model's flirty personality, responsiveness, or emotional vocal control. Existing tag alignment, mouth mapping, animation transitions, cancellation, and memory-refresh work remain open.

## Verification

Thirteen automated checks pass without inference: service/write isolation, fixture failures, memory-dependent recall, local media failure handling, and actual WAV content/duration/timing bounds. Browser verification with Docker off confirmed all five showcase recordings and both recall variants finish playback and restore scene controls; speech and alignment metadata are visible in the collapsible inspector. Voice quality and pronunciation still need the user's listening assessment.
