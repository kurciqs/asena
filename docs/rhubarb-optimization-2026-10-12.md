# Rhubarb optimization and Kokoro streaming strategies — 12 October 2026

## Decision and result

Keep **Kokoro + Rhubarb/PocketSphinx**. The strongest improvement is a native Apple Silicon Release build of the **same Rhubarb 1.14.0 source and recognition resources**. On the seven saved Kokoro recordings it took **0.78–1.62 seconds**, compared with **2.86–5.94 seconds** for the installed Intel executable in this run: approximately **3–4× faster**. No recognition or animation algorithm changes are enabled in the installed native build.

The main path now prefers that checksum-verified native build, supplies the spoken transcript, caps Rhubarb at two requested workers, skips redundant conversion of complete compatible WAVs, caches repeated input privately, and shares one deadline across conversion/alignment. A real Flask route check produced the original introduction cues and released its temporary audio. Its first request took **1.94 s** including fingerprint/setup overhead; an identical cached request took **0.001 s**. These are alignment-only observations, not total reply latency.

The [studio](http://localhost:3001/lip-sync-samples.html) now shows preparation times beside the selected method and includes six additional actual Rhubarb strategies. **All original alternatives remain**: 15 methods × three unchanged recordings = **45 visual comparisons**. Comparison cleanup is explicitly deferred under TODO **11b**.

No Kokoro, Docker, LLM or new speech generation was started. All computation used existing synthetic clips. Every benchmark/model worker was finite and exited. The installed native tool starts only when a live alignment request invokes it; opening the site does not load its recognizer.

## Whole-recording results

Two runs per recording and executable; the table gives their means, using dialogue guidance and one requested worker. There were also two native runs at requested limits of two and four workers. All these short files actually use one recognition worker due to Rhubarb's internal length limit.

| Recording | Audio duration | Intel mean | Native mean | Speedup |
|---|---:|---:|---:|---:|
| Introduction | 3.863 s | 5.345 s | 1.368 s | 3.91× |
| Teasing | 3.743 s | 5.936 s | 1.466 s | 4.05× |
| Disagreement | 4.562 s | 5.723 s | 1.615 s | 3.54× |
| Emotes | 4.182 s | 4.759 s | 1.436 s | 3.31× |
| Memory | 2.565 s | 3.642 s | 1.113 s | 3.27× |
| Recall | 1.849 s | 2.861 s | 0.776 s | 3.69× |
| Empty recall | 2.524 s | 3.294 s | 1.101 s | 2.99× |

Duration-weighted native processing/audio ratio is **0.381**: about 0.38 seconds of processing per second of audio. A value below one indicates throughput faster than playback, with these test conditions. It does not include synthesis, initial audio delivery, model competition or first audible response latency.

The first six fresh native cue arrays are **exactly identical** to the corresponding fresh Intel arrays and saved fixtures. Empty recall has **94.4% time-sampled shape agreement**; native and Intel differ there, so strict bit-for-bit parity is not claimed for every recording. Native runs were stable across the tested thread limits. Subjective acceptance beyond these clips remains a human check.

Earlier October 11 timings were somewhat lower than the current Intel baseline. These are separate laptop runs with background/load/cache variation, not a controlled hardware laboratory. Runs were serial, bounded and repeated, but not randomized. The large architecture improvement is clear; small compiler/input-rate differences are not strong evidence of a speedup.

## Where the time goes

An instrumented native introduction run took 1.304 s. Its component measurements were:

| Component | Time | Approximate share |
|---|---:|---:|
| Word recognition/search | 0.869 s | 67% |
| Cold decoder and language-model setup | 0.343 s | 26% |
| Acoustic phone alignment | 0.072 s | 5.5% |
| Voice activity detection | 0.006 s | 0.4% |

The remainder includes resampling, phone processing and other orchestration. The dominant cost is **recognition**, not converting the recognized phones into mouth shapes or drawing them. Transcript guidance biases the recognizer toward known dialogue; it does not bypass word recognition. This distinction is visible in the [original recognizer source](https://github.com/DanielSWolf/rhubarb-lip-sync/blob/v1.14.0/rhubarb/src/recognition/PocketSphinxRecognizer.cpp).

## Strategies tested and deployment decisions

| Strategy | Measured outcome | Decision |
|---|---|---|
| Native ARM64 Release, `-O3 -DNDEBUG` | 3–4× faster; approximately 155 MiB process RSS on short clips | **Installed and preferred**, with explicit executable override and Intel fallback. |
| M3-specific compiler target | Similar times to standard native, sometimes slightly slower | Keep the portable ARM64 build. No useful gain established. |
| M3 + ThinLTO | Built successfully, then introduction alignment crashed with SIGSEGV in about 0.13 s | **Rejected**, never installed. Cause was not established. Failed runtime is not a speed result. |
| Requested worker counts 1/2/4 | No material short-clip gain; these recordings use one worker internally | Default maximum **2**, to bound longer-clip CPU/RAM demand. |
| Longer recording, worker counts 1/2/4 | Synthetic 25.74 s composite: 6.73 / 4.22 / 3.45 s, with approximately 157 / 306 / 527 MiB RSS | Two workers are the conservative compromise. Four are optional after combined-workload measurement. |
| Dialogue guidance | Similar runtime; without guidance disagreement fell to 90.1% and empty recall to 81.3% agreement with saved cues | **Enabled** in live requests to preserve recognition quality. No speed benefit promised. |
| Persistent decoder reuse prototype | Cold-worker median 1.318 s versus reuse median 1.061 s; approximately 99.7% mean saved-track agreement; peak RSS rose from 156 to 239 MiB over the finite batch | Promising secondary optimization. **Not enabled** as a resident service. Needs lifecycle, long-session memory and cancellation validation. |
| Known-text acoustic alignment prototype | Median 0.318 s with fresh decoder; 0.196 s with reuse across the finite batch | Retain as an **optional visual comparison**. Mean agreement around 81%, with pause/pronunciation changes. This prototype does not preserve the chosen behavior sufficiently for automatic adoption. |
| Upstream phonetic recognizer | Mean 0.312 s; about 71% mean agreement | Faster alternate recognizer, kept for comparison; English production remains PocketSphinx. |
| Direct 16 kHz inputs | Little speed benefit, with cue changes; introduction agreement 88.9% | Not adopted. |
| Original 24 kHz Kokoro audio, headers repaired only | Mean 1.283 s; 97.7% mean agreement, introduction 91.5% | Useful future streaming candidate, but no clear speed/quality reason to change the current alignment normalization yet. |
| Skip redundant WAV conversion | Avoids the ffmpeg invocation when input is already complete mono PCM16 at 44.1 kHz | **Enabled**. Streaming placeholder headers are detected and still normalized. |
| Private exact-input cache | Real repeated introduction request: approximately 1 ms, no recognizer process | **Enabled**, maximum 64 entries, at most 512 KiB per entry. Benefit applies to identical audio/transcript/settings, not arbitrary newly synthesized replies. |

**Agreement** means the fraction of 10 ms sample positions with the same mouth label as a reference track. It is a regression indicator, **not a realism score or a phonetic ground truth**. Different tracks can both look reasonable. A scene-by-scene check is more meaningful than judging only the mean.

The reuse prototype retains an acoustic decoder and updates its dialogue bias for each request. It processes a finite batch of 21 jobs, then exits. The result does not demonstrate indefinitely bounded resident memory. The forced-alignment prototype still aligns phones against audio; it is not equal-duration dictionary mapping. Its simple whole-clip treatment and reused acoustic state need further work. The studio makes those defects available to inspect rather than hiding them behind the faster timing.

Rhubarb's worker cap is the minimum of the requested count, detected utterances and **whole seconds of audio divided by five**, with a floor of one. Under-ten-second segments therefore use one worker. Simply increasing the requested count does not parallelize a short streaming segment. [Implementation](https://github.com/DanielSWolf/rhubarb-lip-sync/blob/v1.14.0/rhubarb/src/recognition/pocketSphinxTools.cpp), [official thread options](https://github.com/DanielSWolf/rhubarb-lip-sync#advanced-command-line-options).

## Streaming policy experiments

Rhubarb remains a completed-audio analyzer. Streaming Kokoro can feed **bounded audio regions** to it while later audio is still being generated. Analysis windows and network chunks must be separate concepts.

On the three short clips, native one-second retained regions with 250 ms context on each side took 2.77–3.85 s of total processing. Two-second regions took 1.75–2.74 s; three-second regions took 1.87–2.14 s. Whole-recording analysis remained fastest. Batching adds repeated decoder initialization and duplicate overlap work.

A longer composite concatenates the seven existing clips with 350 ms silence between them. It is a **synthetic workload**, not a naturally generated long response. Window outputs are compared with its whole-recording native Rhubarb track:

| Retained-region policy | Total compute for 25.74 s audio | Reference agreement | Simulated continuous-play start, 1× arrival | Simulated start, 2× arrival |
|---|---:|---:|---:|---:|
| 1 s, ±250 ms context | 19.81 s | 87.9% | 2.33 s | 1.38 s |
| 2 s, ±250 ms context | 12.65 s | 90.8% | 3.42 s | 2.07 s |
| 3 s, ±250 ms context | 11.06 s | 91.1% | 4.68 s | 2.89 s |
| 5 s, ±250 ms context | 9.11 s | 92.7% | 7.01 s | 4.34 s |
| Sentence boundaries, ±250 ms context | 11.33 s | 92.6% | 4.48 s | 2.23 s |

The start column is the **minimum initial delay predicted to avoid gaps across this finite workload**, using the measured processing times and assuming PCM becomes available continuously at one or two audio seconds per wall second. It excludes Kokoro's initial response delay and shared CPU contention. It is **not a measured streaming service latency**. Source delivery may arrive in larger bursts, making these assumptions inaccurate.

Sentence boundaries performed well on introduction (99.0% agreement), but not uniformly better on teasing/disagreement (95.7%/94.7%). Three-second fixed regions reached 99.6% on disagreement. Two-second windows **without context** fell to 76.5% there. No single boundary policy is visually accepted yet.

My recommended next implementation is a **phrase/sentence-aware assembler**, targeting approximately 2–3 seconds and allowing longer complete phrases when needed, with up to 250 ms context. The fixed two-second policy is the speed/quality control; complete native Rhubarb is the quality reference. Prefer pauses/word boundaries over cutting arbitrarily through a word. Do not reduce TTS synthesis chunks merely to match network packet sizes: voice continuity needs its own live check.

## Exact Kokoro contract and proposed pipeline

Read-only source inspection used the installed image's recorded revision **`404d122e847569012bd6a6afe36f1c3a5e1c66b7`**, not the moving default branch:

- `/dev/captioned_speech` with `stream=true` returns **newline-delimited JSON** containing base64 audio, audio format and word timestamps. It is not SSE. HTTP reads can split UTF-8, JSON or base64 at any byte; accumulate complete lines before parsing. [Router](https://github.com/remsky/Kokoro-FastAPI/blob/404d122e847569012bd6a6afe36f1c3a5e1c66b7/api/src/routers/development.py), [framing implementation](https://github.com/remsky/Kokoro-FastAPI/blob/404d122e847569012bd6a6afe36f1c3a5e1c66b7/api/src/structures/custom_responses.py).
- Prefer **24 kHz mono signed-16 PCM** for the eventual transport. The writer returns raw sample bytes for PCM; its audio conversion normalizes to int16. WAV streaming output has a shared container/header and should not be interpreted as an independent complete WAV on every network read. [Writer](https://github.com/remsky/Kokoro-FastAPI/blob/404d122e847569012bd6a6afe36f1c3a5e1c66b7/api/src/services/streaming_audio_writer.py), [normalization](https://github.com/remsky/Kokoro-FastAPI/blob/404d122e847569012bd6a6afe36f1c3a5e1c66b7/api/src/services/audio.py).
- Word timestamps already receive a **cumulative offset within each Kokoro request**. Do not add each chunk's duration again. Separate TTS requests require one request-base offset onto Asena's turn timeline. Caption/audio trimming and missing timestamps still need a captured live-contract check. [Offset logic](https://github.com/remsky/Kokoro-FastAPI/blob/404d122e847569012bd6a6afe36f1c3a5e1c66b7/api/src/services/tts_service.py).

The planned path is:

```text
Kokoro captioned PCM stream
  → incremental NDJSON decoder
  → bounded PCM/timestamp assembler on a cumulative sample timeline
  → phrase regions plus retained left/right analysis context
  → finalized private WAV for native Rhubarb + local spoken transcript
  → validated cues shifted onto the same sample timeline
  → existing audio-clock scheduler plays each region exactly once
```

The **analysis** region may include overlap; the **played** region must not. Trim returned cues to the retained interval, offset them once, and keep the original PCM for playback. Optional alignment normalization can resample the analysis copy to the currently accepted 44.1 kHz path while leaving the voice untouched. Finalize finite WAV headers before invoking Rhubarb; flush a short final region without requiring unavailable future context.

Start playback only after matching mouth data and an appropriate buffer exist. Bound unaligned PCM and prepared segments, apply producer backpressure, and stop both audible playback and stale-result ownership together. The current route is serial and deadline-bounded; a client abort does not yet terminate its already-running subprocess immediately. Explicit per-turn worker cancellation, queue ownership and streaming transport remain TODOs 12–14.

Decoder reuse may eventually load its recognizer while the first audio region is arriving and save approximately 0.24 s per subsequent short request. It needs a lazy start, one bounded worker, idle expiry, a bounded vocabulary/search lifecycle and forced termination on deadline/cancellation before becoming a production service. No resident worker was introduced in this task.

## Implementation, verification and limitations

- **Executable selection:** a project-local ARM64 build is preferred only on ARM64, with an unmodified-build manifest and matching executable checksum. `ASENA_RHUBARB` overrides it. Missing/invalid native installation falls back to the original adjacent Rhubarb installation. Backend changes take effect on the next server start; the current website remains offline replay. Tools and recognition resources remain ignored, outside public assets.
- **API:** `/get_visemes` accepts a server-issued audio ID and optional bounded `spoken_text`; paths/extra keys/invalid text are rejected. The frontend supplies the parsed spoken text. Requests return conversion/alignment/cache timings, which appear in the existing inspector. Original audio ownership and cleanup are preserved.
- **Cache:** keys cover audio bytes, spoken text, Rhubarb binary/resources, thread limit and conversion configuration. Entries contain cue data only, no raw audio or transcript; directory/file modes are 0700/0600. Failed cache reads/writes cannot turn successful alignment into a speech failure. Set `ASENA_ALIGNMENT_CACHE_ENTRIES=0` to disable it.
- **Resource defaults:** `ASENA_RHUBARB_THREADS=2`; existing process deadline applies to the complete conversion/alignment path. Benchmark/build supervisors use a 768 MiB process-tree RSS guard, serial analysis, single-job compilation and task deadlines. Monitoring failures terminate the child group.
- **Checks:** 26 Python and 53 JavaScript regressions pass. New checks cover cache invalidation/bounds/corruption, private cache writes, complete versus placeholder WAVs, transcript validation, one shared deadline, cleanup and native fallback. A finite real-native Flask route/cache check also passes. All 45 studio tracks have finite bounded values, meaningful motion, matching original audio hashes and deterministic seeking. Browser review checks timing text, selected strategy and actual applied morphs.
- **Scope:** TTS streaming is designed and simulated, not implemented. No combined LLM/Kokoro/Rhubarb workload was run. The previous production mouth-alphabet mapping defect and happy-expression distortion are separate rig issues; the studio's corrected adapter remains the visual reference.
- **Environment:** read-only setup preflight has zero blocking issues, but the general Python environment reports pre-existing dependency drift against `requirements.txt`. No packages were upgraded. Compilation and fixture analysis used existing CMake/Clang/Python/ffmpeg tools.

## Reproduction and retained artifacts

The official Rhubarb **v1.14.0** source resolved to **`9b9573cd21b253c9ba58739bbd1aa0b50b991bff`**. Its LFS test-audio checkout required disabling the missing Git LFS filter; no Git LFS installation was made. Recognition resources are ordinary source files. Boost **1.85.0** headers were extracted from the official archive, SHA-256 **`7009fe1faa1697476bdc7027703a2badb84e849b7b0baad5086b087b971f8617`**. Nothing was installed globally.

The standard builder omits unrelated plugin packaging targets and restores recognizer sources before building. Compiler experiments are separate directories. Profiling/reuse/known-text patches are produced by a separate builder, with the original native binary preserved. The installer refuses an executable that does not match the standard build checksum. [Upstream build configuration](https://github.com/DanielSWolf/rhubarb-lip-sync/blob/v1.14.0/rhubarb/CMakeLists.txt).

```sh
# After obtaining the pinned official source and Boost archive in the work directory:
python3 scripts/rhubarb_benchmark.py guard --name native-build-supervisor --timeout 1100 -- python3 scripts/build_native_rhubarb.py
python3 scripts/build_rhubarb_experiments.py
python3 scripts/rhubarb_benchmark.py matrix --binary .runtime/rhubarb-optimization/native-baseline/rhubarb --label native-dialog --threads 1 2 4 --repeats 2
python3 scripts/run_rhubarb_strategy_suite.py
python3 scripts/run_rhubarb_strategy_suite.py --stream-only
python3 scripts/install_native_rhubarb.py
python3 scripts/summarize_rhubarb_results.py
node scripts/add_rhubarb_strategy_samples.mjs
```

The matrix supports distinct labels, alternate executables/recognizers and bounded repeat counts. Existing result IDs are skipped; use a new label for a fresh run. The full evidence includes the separate Intel/M3/input-rate experiments and finite worker results; do not assume every table is regenerated by the abbreviated sequence above. A clean setup needs the existing ffmpeg/compiler dependencies and permission to inspect its own child processes.

[Machine-readable measurements and cue outputs](evidence/rhubarb-optimization-2026-10-12.json) are tracked. Full logs, copied source, compiler builds and intermediates remain in ignored `.runtime/rhubarb-optimization/`, approximately **976 MiB** at measurement. The independent installed native tool/resources are about **85 MiB** in `.runtime/tools/rhubarb-1.14.0-arm64/`. Original 24 kHz test inputs were copied from the prior temporary capture and had only WAV headers rebuilt; their PCM samples were preserved. Their availability is not guaranteed after temporary-directory cleanup.

TODO **11b** is deliberately unchecked. Later pruning can remove the studio's unused alternatives, vendor/preparation code and experiment/build cache, while preserving the selected runtime tool, measurements and original fixtures. The user's separate edit to the older speech plan was left untouched. Visual boundary-policy acceptance, a captured live PCM contract and the combined resource benchmark remain the next gates.
