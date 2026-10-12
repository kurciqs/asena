# Kokoro streaming implementation and live trials — 12 October 2026

**Kokoro → continuous Rhubarb → synchronized browser playback now works in the diagnostic page, and is wired into the main companion as an opt-in path.** Two actual browser trials played 26.10 seconds of freshly generated speech without scheduled gaps. The main companion also completed playback and Pause/Resume using a captured real Kokoro packet, with the LLM and TTS off.

The user authorized temporary Kokoro activation for diagnostics. The existing ARM64 v0.9.0 container was reused with **two CPU cores, 2 GiB RAM, no additional swap allowance, no restart policy**, and loopback port 8881. Its image revision was verified as `404d122e847569012bd6a6afe36f1c3a5e1c66b7`. No LLM was loaded or called. The container ran from **19:26:05 to 19:32:42 UTC**, approximately **6 minutes 37 seconds**, then exited normally (`ExitCode=0`, `OOMKilled=false`). No containers remained running, and Docker Desktop was stopped.

## What changed

- The server requests captioned **PCM16 mono at 24 kHz**, `stream=true`, and reads newline-separated JSON incrementally. Transport reads, provider packets, analysis windows and playback blocks are distinct boundaries. The parser handles fragmented UTF-8/JSON and rejects malformed or incomplete frames.
- Audio is assembled into an integer sample timeline. One native Rhubarb process handles a completed **two-second retained region**, with up to **250 ms of context on each side**. The stream retains its original 24 kHz samples; Rhubarb reads a finalized WAV at that rate, so no extra ffmpeg conversion is needed. Cues are trimmed and offset once to the global timeline. Context is never played twice.
- Audio and matching mouth cues are released together. The browser starts with a **two-second reserve** by default in the opt-in companion path, then schedules contiguous PCM buffers on Web Audio's clock. The diagnostic page also offers a four-second reserve. An exhausted buffer produces silence and a resting mouth, and resumes when the next region is ready.
- The corrected Rhubarb mouth mapping and PCM player are now shared modules, used by both the diagnostic page and the opt-in main companion. Existing complete-WAV playback remains available when streaming is disabled. The comparative audition methods were preserved.
- The main companion sends only the fully parsed spoken reply to speech generation. Partial word timing can now anchor emotions and gestures before all later words arrive; future tags wait for their corresponding words. Streaming does not yet consume LLM text tokens. Pause/Resume suspends/resumes the audio clock; Stop cancels audio, the provider connection and alignment ownership. Gesture animation freezes during pause/starvation while idle motion can continue.
- Provider socket shutdown interrupts a blocked read immediately. The recognizer is killed as a process group, temporary region files are removed, and exclusive ownership remains held until the reader/alignment workers exit. Replay and foreign-origin boundaries continue to block live work.

## Actual measurements

All trials used `af_heart`, speed 1, native single-worker Rhubarb, no alignment cache and fixed synthetic introduction/conversation text. Times exclude container startup/warmup and any LLM request. Runs were serial and background laptop load was not controlled.

| Trial | Speech duration | First Kokoro packet | First playback | Gaps |
|---|---:|---:|---:|---:|
| Short introduction, two-second reserve, CLI wall-clock sink | 4.29 s | 2.37 s | 3.91 s | 0 |
| Conversation, two-second reserve, actual browser | 26.10 s | 8.04 s | **10.09 s** | **0** |
| Conversation, four-second reserve, actual browser | 26.10 s | 8.78 s | **12.34 s** | **0** |
| Short introduction, final interruptible HTTP transport, CLI sink | 4.29 s | 2.33 s | 3.92 s | 0 |

The CLI sink measures wall-clock consumption without audible output. Browser startup is a Web Audio output-time estimate, not a microphone measurement. Zero gaps means no scheduled source starvation; hardware/OS underruns were not independently measured with loopback capture.

The two-second browser trial required **18.66 seconds of Rhubarb work** for 26.10 seconds of speech. The four-second run required **17.52 seconds**. Native process-tree RSS was approximately **155 MiB**. Actual mouth motion reached **0.75** and returned to neutral. The two-second run's minimum prepared buffer before EOS was about **0.36 seconds**: it passed, but had limited reserve. This is a small sample, not sustained combined-workload acceptance.

**The main bottleneck is now Kokoro's first packet.** The conversational passage arrived in two packets, containing about **13.63 and 12.47 seconds of audio**. Selecting two-second Rhubarb regions cannot make Kokoro emit its first packet sooner. Playback nevertheless began while Kokoro was still delivering later speech: first playback at 10.09 seconds versus stream EOF consumed at 17.66 seconds in the two-second trial. That EOF time includes any receiver backpressure and must not be interpreted as pure synthesis completion time.

The first short provider response was one complete 4.29-second packet; in that case, streaming only overlapped regional analysis/playback, since the short audio was already generated. The live cancellation trial's first packet took **13.71 seconds**, showing that first-packet time varies materially between runs. It was cancelled rather than included as a completed throughput comparison.

## Cancellation, memory and bounds

The live cancellation check stopped during the first native alignment while Kokoro was preparing later speech. Our provider-reader thread and native child exited in **0.0069 seconds after cancellation** in that observation, with no queued late events. This measures local connection/worker cleanup, not the instant the upstream neural operation stops. Docker was shut down shortly afterwards; upstream synthesis may finish an in-flight operation before detecting the disconnect.

The final HTTP transport also passed a successful short live stream. Browser comparisons used the earlier requests transport with the same parser/region/player; the transport changed afterward to improve cancellation. The final transport's long-duration playback has not been separately rerun. A fake local HTTP server confirms that cancellation interrupts a blocked socket read without waiting for the 15-second read timeout.

Incoming retained PCM is capped at **16 seconds**, prepared audio at **12 seconds**, and the browser permits at most 12.5 seconds to accommodate acknowledgement timing. One decoded provider packet can additionally contain up to **30 seconds**; this bounded pending packet is distinct from the rolling incoming queue. Completed PCM is discarded except for the 250 ms context retained for the next region. Audio length and total elapsed time are capped at three minutes; pausing does not extend that overall deadline. Packet/word counts and JSON frame sizes are bounded. Alignment has a 15-second deadline and 384 MiB process-tree RSS guard. No decoder stays resident between regions.

Sparse container readings were around **1.28–1.36 GiB**. The six repeated samples landed after synthesis activity and reported approximately 0.27–1.06% CPU, so they **do not measure synthesis CPU or peak container memory**. Docker VM/browser/system memory and swap pressure were not sampled. This remains a gap for a combined-workload budget; do not infer spare capacity for the LLM from these readings.

## How to use it

Streaming is deliberately opt-in. For a later prepared live session, start Kokoro manually, then start the main website with:

```sh
ASENA_MODE=live ASENA_SPEECH_STREAMING=1 \
ASENA_KOKORO_API=http://127.0.0.1:8881/dev/captioned_speech \
python3 server.py
```

Opening the website never starts Docker, Kokoro or the LLM. A chat submission still requires the configured LLM; it was not tested live here. The existing website at port 3001 was not restarted or switched into streaming during these trials.

For fixed-text speech trials without an LLM:

```sh
ASENA_KOKORO_API=http://127.0.0.1:8881/dev/captioned_speech \
python3 scripts/rhubarb_stream_probe.py --serve --allow-kokoro
```

Choose **Voice source → Live Kokoro** at `http://localhost:3002/stream-test.html`. Start explicitly generates speech. The normal server invocation omits `--allow-kokoro` and permits saved audio only. After the tests, the diagnostic server was restored to that saved-only mode.

Offline main-companion verification is reproducible with `python3 tests/stream_fixture_server.py` at port 3003. It uses a fixed chat reply and the captured short PCM packet, invokes Rhubarb only after Send, and never calls TTS/LLM or saves memories. This temporary verification server was stopped after the check.

## What remains

1. **Reduce first-packet latency.** Test a short first spoken phrase and tune provider segmentation while checking prosody. The API schema inspected during this run does not expose a request-level packet-size control. A transport flag alone cannot promise instantaneous speech.
2. Repeat longer real streams with the final HTTP transport, two/four-second reserves and measured CPU/memory pressure. Then separately coordinate any simultaneous LLM/Kokoro workload. The final transport has successful short-stream and live-cancellation evidence; long browser playback used the earlier transport.
3. Review live gesture/emotion timing on more replies and rigs. The recorded happy-expression mouth distortion remains deferred; these live diagnostic passages used neutral facial emotion. The main fixture exercised a wave and Pause/Resume, not every expressive state.
4. Add an explicit per-reply fallback choice and broader rig validation under TODO 14. A streaming failure currently leaves the text reply and offers retry; it does not silently regenerate a complete recording after partial playback. The complete-WAV configuration remains available.
5. Keep comparison pruning under TODO 11b deferred until authorized.

## Evidence and checks

- [Two-second browser report](evidence/kokoro-stream-browser-2s-2026-10-12.json) · [Four-second browser report](evidence/kokoro-stream-browser-4s-2026-10-12.json) · [Browser screenshot](evidence/kokoro-stream-browser-2026-10-12.png).
- [First protocol capture](evidence/kokoro-live-protocol-short-2026-10-12.json) · [First short trial](evidence/kokoro-live-stream-trials-2026-10-12.json) · [Final HTTP short trial](evidence/kokoro-live-http-trial-2026-10-12.json) · [Final HTTP packet capture](evidence/kokoro-live-http-trial-2026-10-12-protocol.json).
- [Live cancellation evidence](evidence/kokoro-stream-cancel-2026-10-12.json) · [Sparse container samples](evidence/kokoro-stream-container-samples-2026-10-12.json) · [Main companion Pause check](evidence/kokoro-main-stream-paused-2026-10-12.png).

**45 Python and 65 JavaScript checks pass.** Coverage includes captured PCM, fragmented JSON/UTF-8, malformed/truncated streams, integer sample ownership, final tails, bounded backpressure, cumulative timestamps, blocked-socket cancellation, token isolation, unconsumed HTTP response cleanup, replay/network boundaries, partial tag anchors, playback cleanup, pause and opt-in orchestration. Browser verification separately covered real generation/PCM playback and the main companion using captured audio. No automatic test starts a model.
