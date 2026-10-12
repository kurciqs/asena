# Reducing Kokoro startup delay — 12 October 2026

**The live test viewer now exposes shorter phrase generation and smaller starting reserves.** On the same 80-word, 439-character passage, actual browser first playback was **4.54 seconds with no scheduled gaps**, compared with **11.33 seconds for the original whole-passage mode** in this session. A one-second reserve started at **3.00 seconds**, with two early pauses totalling **1.02 seconds**.

The text is visible before generation starts. While waiting for the first packet, the viewer shows a changing elapsed-time counter and identifies whether Kokoro is generating audio or Rhubarb is preparing mouth timings. Provider arrival timing updates on each packet rather than waiting for the final report.

## What changed

- Added an optional `phrases` strategy to the existing speech stream. The opening request prefers punctuation within approximately 60 characters; following requests prefer punctuation within approximately 90 characters. Whitespace is the fallback. These are character limits, not model-token counts or guaranteed audio durations. Requests preserve the input text order and are generated sequentially with one Kokoro connection at a time.
- Audio from every request is appended to the same integer PCM timeline. Kokoro timestamps restart per request, so the receiver adds the exact preceding sample duration once. Rhubarb cues and playback stay on that shared clock.
- Completed phrases flush their final short analysis region immediately. The recognizer no longer waits for the next synthesis request to finish before releasing a completed phrase's remaining audio. Context is bounded to the phrase end, and is never played twice.
- The first Rhubarb region can be 0.5, 1 or 2 seconds, capped by the selected later-region size. Startup reserves can be 0.5, 1, 2 or 4 seconds. Audio still waits for matching mouth cues; lowering a reserve below the region size alone cannot release half of a region.
- The viewer's live defaults are **short phrases, a one-second opening region, two-second later regions, and a two-second startup reserve**. The original whole-passage strategy remains selectable. Saved-audio mode retains its existing supported reserves.
- The health response exposes only the fixed synthetic trial texts, allowing the page to display them immediately. Run metadata reports text length, request count, per-packet arrival, request index and strategy.

The main companion's existing configuration and defaults have **not** been switched to phrase generation. The shared backend supports it, but this first rollout is the fixed-text viewer so Jakub can judge the voices and pauses before applying it to conversation. No LLM was loaded or called. No Kokoro image, container limits, model weights or global provider settings changed.

## Measurements

Same voice (`af_heart`), speed 1, one native ARM64 Rhubarb worker, final interruptible HTTP transport, serial trials. Browser runs use the actual Web Audio clock and actual VRM mouth mapping. Background laptop load was not controlled; each configuration has one recorded browser run.

| Browser run | Speech duration | First Kokoro audio | First playback | Scheduled gaps |
|---|---:|---:|---:|---:|
| Original whole passage, 2 s first region / 2 s reserve | 26.11 s | 9.51 s | **11.33 s** | 0 |
| Short phrases, 1 s first region / 1 s reserve | 24.80 s | 1.81 s | **3.00 s** | 2 / 1.02 s total |
| Short phrases, 1 s first region / 2 s reserve | 24.80 s | 2.00 s | **4.54 s** | **0** |
| Short introduction, phrases, 1 s first region / 2 s reserve | 4.38 s | 2.21 s | 4.73 s | 0 |

The two-second phrase run reduced startup by approximately **60%** relative to this session's original-mode run. Its prepared buffer briefly fell to **0.44 seconds** before EOS despite later reaching **9.41 seconds**. A large surplus later in playback does not establish that starting earlier will be gap-free.

The one-second run's pauses occurred after source positions 1.00 s and 2.59 s, while the opening phrase tail and next region were being prepared. Both pauses kept the mouth neutral. The browser observed mouth movement up to 0.75 and neutral completion. Browser warning/error logs were empty during the recorded sustained check.

**Short replies do not have the paragraph-sized first-packet problem.** The recorded short phrase run was not faster than the earlier 3.92-second CLI whole-text short run; those are different receivers and sessions, so this is not a controlled regression measurement. Do not claim that phrase splitting improves every reply. For short replies, compare whole-text generation and a first region matching the reserve to avoid unnecessary small-region overhead.

Independent phrase generation changed the total speech duration from approximately 26.1 s to 24.8 s. Playback speed remains 1; the change comes from regenerated phrasing/pause behaviour. Prosody and seam quality require listening review. No assertion that voice quality is identical is made.

## Experiments that informed the final version

An initial small-opening / larger-following-request experiment started its CLI sink at 6.86 s, but stalled for 3.85 s because a phrase tail waited for the next request. Its first packet also took 5.87 s, demonstrating substantial timing variation. This experiment motivated immediate tail flushing and smaller following requests; it is retained as evidence rather than included as a final-mode result.

The revised CLI wall-clock sink started at 2.53 s and counted approximately 0.15 s of pauses. It produced no audible output. The actual browser one-second run showed more pauses, so the browser result governs the recommendation. Half-second settings passed offline scheduling checks but have **not** been measured live.

## How to review

Open [the live test viewer](http://localhost:3002/stream-test.html?source=live). No generation starts on page load. Start with the default two-second reserve and the sustained passage; select one second to compare earlier playback against pauses. For the original baseline, select **Whole passage**, a **two-second first region**, and a **two-second reserve**.

Kokoro was already running under explicit user authorization and remains available for this review session. Its existing two-CPU, 2 GiB container limits are unchanged. No background benchmark loops or automatic generation were added. The page's Stop control cancels the active speech and alignment job; it does not shut down Docker.

## Verification and remaining work

**47 Python tests and 66 JavaScript tests pass.** New checks cover exact text preservation, request-local to sample-global timestamp conversion, finalized phrase tails becoming available while the next request is blocked, sample continuity through request boundaries, bounded option validation, and half-second startup/starvation with a resting mouth. Existing cancellation, ownership, playback, replay and origin-boundary checks still pass. Browser verification separately establishes actual generation/playback and immediate text/progress display.

These are fixed synthetic passages, not LLM latency or combined-workload acceptance. First playback is a Web Audio output-clock estimate, not microphone capture; gaps are scheduled source starvation, not independent hardware-underrun measurements. Longer replies, varying punctuation, different voices, cold-start behaviour and phrase seam quality remain to be evaluated.

TODO 13 remains open: this implements its speech-segmentation prototype, but does not stream LLM tokens or apply the chosen policy to production conversation. Comparison pruning under TODO 11b remains deferred.

## Evidence

- [Original-mode browser report](evidence/kokoro-startup-browser-baseline-2026-10-12.json)
- [One-second-reserve browser report](evidence/kokoro-startup-browser-phrases-1s-2026-10-12.json)
- [Two-second-reserve browser report](evidence/kokoro-startup-browser-phrases-2s-2026-10-12.json)
- [Short-reply browser report](evidence/kokoro-startup-browser-short-2026-10-12.json)
- [Initial larger-following-request experiment](evidence/kokoro-startup-phrases-1s-2026-10-12.json)
- [Revised CLI phrase-tail trial](evidence/kokoro-startup-phrases-tail-1s-2026-10-12.json)
- [Waiting-stage viewer screenshot](evidence/kokoro-startup-text-wait-2026-10-12.png)
- [Final viewer with text visible before generation](evidence/kokoro-startup-viewer-2026-10-12.png)
