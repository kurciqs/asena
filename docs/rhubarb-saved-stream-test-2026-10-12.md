# Saved-audio continuous Rhubarb test — 12 October 2026

Stage 1 uses existing synthetic Kokoro recordings only. **No Kokoro, Docker, LM Studio, LLM or new speech generation is started. Stage 2 is waiting for coordination with Jakub.**

The probe delivers saved PCM gradually, invokes actual native Rhubarb/PocketSphinx on each completed analysis region, and releases matching audio/mouth data to a receiver. Alignment caching is disabled. Unlike the earlier readiness simulation, Rhubarb runs during the paced test; its timings and queue behaviour are measured in that run.

## What was built

- A separate loopback test server and page at [saved-audio streaming test](http://localhost:3002/stream-test.html). Opening it loads the avatar, but does not start recognition. Start explicitly runs the fixed saved recordings.
- One-, two- and three-second retained regions, plus punctuation-based sentence boundaries capped at five seconds. Every region has up to 250 ms of left/right analysis context. Playback contains only the retained samples: overlap is analysed but never played twice.
- Steady delivery at one or two audio seconds per wall second; a burst profile delivers 750 ms packets and deliberately delays the 10–12 second interval by two seconds before catching up. These are synthetic delivery patterns, not captured Kokoro traffic.
- At least two or four seconds of prepared audio before playback. A region is indivisible for this threshold: a three-second first region satisfies a two-second threshold by itself.
- A 25.74-second composite of the seven unchanged fixtures, with 350 ms silence after each, and a 77.21-second repeated version. Source/segment sample ownership and hashes are recorded. The full saved source is preloaded as a fixed small fixture; logical incoming/prepared queues are bounded separately.
- A CLI receiver uses the real wall clock to account for playback and starvation, without producing sound. The browser receiver schedules actual PCM buffers on Web Audio's clock and drives Asena's corrected Rhubarb adapter from the audio output position. Browser/device timings are kept separate from CLI results.
- A test report can be downloaded from the page. It includes input provenance, actual alignment timings/cues, queue peaks, starvation gaps, and browser playback/binding diagnostics.

## Watching the buffer run out

Select **Audio delivery → Show buffering · eight-second delivery pause**, then Start. This profile delivers audio at playback speed but holds delivery for eight seconds near the ten-second source position, then resumes at playback speed. It deliberately exhausts the two- or four-second startup reserve. It is a demonstration of starvation, not a measured Kokoro delivery pattern, and is excluded from the normal benchmark matrix.

The live playback indicator changes from Preparing to Playing to **Buffering · waiting …s**, and returns to Playing once aligned audio resumes. During a gap the audio position stops and the mouth rests; the prepared-audio reading shows the remaining ready samples. Completed gaps are counted when the next region is scheduled, so the waiting timer shows an ongoing gap before its final duration enters the gap total. The mouth also remains neutral between receipt of a new region and its actual scheduled output.

Browser verification with two-second regions and a two-second reserve observed the audio position held at **8.00 seconds**, mouth movement **0.00**, and **5.3 seconds of ongoing waiting**. Playback subsequently resumed and completed all 25.74 seconds; that run recorded three gaps totalling 8.26 seconds, including smaller gaps outside the deliberate delivery pause. These figures belong to the artificial demonstration. [Waiting screenshot](evidence/rhubarb-buffering-demo-2026-10-12.png). The updated checks pass: **35 Python and 60 JavaScript tests**, including neutral mouth output during starvation and scheduled recovery.

## Resource and ownership limits

Only one recognizer is allowed across saved-audio probes; a cross-process lock prevents a browser test from competing with a CLI test. Each recognition job requests one worker, has a 15-second deadline and a 384 MiB process-tree RSS limit. These are test-harness limits, not a claim about total laptop memory or CPU usage. Decoder/model resources exit with every region; no recognizer is resident between jobs.

Incoming unprocessed audio is bounded at 16 seconds and prepared audio at 12 seconds. Browser acknowledgements release prepared capacity; a faster producer waits when either queue fills. The maximum turn length is the fixed 77.21-second fixture. A total deadline also bounds an abandoned receiver.

Stop silences scheduled browser nodes immediately, signals the test owner and kills the current recognizer process group when cancellation is observed (polled every 50 ms). Temporary region WAV/transcript/output files are removed. Hiding/leaving the page cancels instead of silently continuing audible playback. Stale progress errors cannot stop a later run.

## Measured paced tests

The following use the CLI wall-clock receiver. Gap accounting is sampled every 10 ms, so small gap durations are approximate. This measures pipeline starvation; it does not measure a sound device or subjective mouth quality. Runs are serial laptop observations, not a randomized laboratory study.

| Policy | Delivery | Audio | Startup threshold | First playback | Alignment work | Gap total |
|---|---|---:|---:|---:|---:|---:|
| 1 s | steady 1× | 25.74 s | 2 s | 2.99 s | 21.01 s | 0 |
| 2 s | steady 1× | 25.74 s | 2 s | 3.32 s | 14.11 s | 0.285 s |
| 3 s | steady 1× | 25.74 s | 2 s | 4.74 s | 11.98 s | 0.170 s |
| sentences | steady 1× | 25.74 s | 2 s | 5.48 s | 12.76 s | 0 |
| 2 s | steady 1× | 77.21 s | 4 s | 5.28 s | 44.45 s | 0 |
| 2 s | steady 2× | 77.21 s | 4 s | 3.12 s | 45.00 s | 0 |
| 2 s | burst/stall | 77.21 s | 4 s | 5.51 s | 47.00 s | 0.169 s |
| 1 s | steady 1× | 77.21 s | 2 s | 3.03 s | 71.91 s | 3.136 s |

The extended one-second run is an important counterexample to the successful short run: it started after **3.03 seconds**, but produced **nine gaps totalling approximately 3.14 seconds**. Recognition work rose to **71.91 seconds for 77.21 seconds of audio**, approximately 0.93 processing seconds per audio second. The gaps clustered in a slower part of this laptop run. Background load and run order were not controlled, so the precise size of the deterioration is not a reproducible hardware constant. The result establishes that the low-buffer one-second policy is fragile under the tested conditions.

**Recommendation for stage 2:** start with native two-second regions and a four-second prepared-audio threshold, retain the one-second/two-second-buffer policy as the lower-latency comparison, and capture actual Kokoro delivery before tuning the startup policy. Do not interpret the earlier short one-second success as sustained acceptance. [Extended fast-policy evidence](evidence/rhubarb-stream-fast-2026-10-12.json).

The important distinction is **throughput versus buffering**. Two-second analysis takes substantially less CPU work than one-second analysis, but a two-second startup threshold starts after only one two-second region. Variation in the next region's readiness can then create a gap. One-second regions prepare two regions before starting with the same threshold, leaving more useful lookahead at a smaller startup cost.

The faster-delivery long run reached 15.95 seconds of incoming audio and 11.19 seconds of prepared audio; backpressure kept these within their limits. The deliberate delivery stall still caused one brief gap with four seconds prepared. This is a useful failure case: faster-than-playback average throughput does not guarantee uninterrupted playback through every delivery stall.

[Raw paced evidence](evidence/rhubarb-stream-probe-2026-10-12.json) contains every region's actual recognition time, input/retained sample interval, cue output, PCM hash and readiness time. It contains no newly generated speech.

## Browser verification

Actual browser playback completed the **77.21-second** steady-1× test using two-second regions and four seconds of prepared audio. First scheduled output was approximately **5.90 seconds** after Start; **zero scheduled playback gaps** were recorded. Alignment work totalled **53.24 seconds**, approximately 0.69 seconds per audio second. Peak Rhubarb RSS was **156 MiB**. The browser's prepared-audio buffer stayed above **1.62 seconds** before end-of-input; all **3,405,060 source frames** were consumed once. The 44.1 kHz input was scheduled through a 48 kHz AudioContext.

A separate **25.74-second browser run with steady 2× delivery** started in approximately **3.42 seconds**, completed with **zero scheduled gaps**, and used **15.02 seconds** of alignment work. This illustrates the benefit of earlier audio delivery under the synthetic profile, not a measured Kokoro speed. [Faster-delivery browser report](evidence/rhubarb-stream-browser-fast-2026-10-12.json) · [Completed test screenshot](evidence/rhubarb-stream-browser-2026-10-12.png).

Actual rig inspection found **48 mouth morph bindings**, with observed movement peaking at **0.75** and returning to neutral at completion. The result is a browser scheduling/output-clock check; there was no audio-device loopback capture to independently detect operating-system/hardware underruns or measure perceptual synchronization. CPU percentage and total browser/system memory were not sampled.

[Browser report](evidence/rhubarb-stream-browser-2026-10-12.json) retains the complete measured region history. The browser and CLI are separate runs, so their timing difference is not an isolated measurement of renderer overhead. A separate finite HTTP smoke check cancelled an **actual Rhubarb process during recognition**. The process terminated, its temporary region directory was removed, no late segment was emitted and the test server returned idle. Cancellation-to-stream-end was **0.0074 seconds in that observation**, not a general latency guarantee. [Cancellation evidence](evidence/rhubarb-stream-cancel-2026-10-12.json). The browser Stop check additionally silenced scheduled audio during playback, returned the mouth to neutral, cleared prepared audio and re-enabled the controls. [Stop screenshot](evidence/rhubarb-stream-stop-2026-10-12.png).

The player queues PCM on Web Audio's rendering clock and uses `getOutputTimestamp()` to estimate the output position for mouth movement and completion. It falls back to rendering time minus reported output latency when the output timestamp is unavailable. This avoids assuming that samples already rendered by the audio graph have reached the output device. The browser first-playback figure is an output-time estimate, not a microphone/loopback measurement. [Web Audio specification](https://www.w3.org/TR/webaudio/#dom-audiocontext-getoutputtimestamp).

## What this establishes, and what remains

The saved-audio experiment tests whether analysis can keep ahead of continuous consumption, how much buffering protects it, sample ownership, browser scheduling, rig binding and cancellation. It does not establish live Kokoro viability by itself.

Stage 2 must capture actual Kokoro NDJSON/PCM delivery, including initial response delay and burst sizes, and repeat the same queue/playback measurements. The current fixtures are 44.1 kHz mono PCM16; actual Kokoro's 24 kHz transport, framing, resampling policy and transcript/timestamp delivery still require that test. A combined LLM/Kokoro/Rhubarb workload remains a separately coordinated resource test. Normal companion playback and its existing mapping are unchanged by this diagnostic page.

## Running the probe

From the project directory, with the installed native Rhubarb tool available:

```sh
python3 scripts/rhubarb_stream_probe.py --serve
python3 scripts/rhubarb_stream_probe.py --matrix
python3 scripts/rhubarb_stream_probe.py --policy 1s --profile steady1x --startup 2 --repeats 3 --output /tmp/rhubarb-fast-stream.json
```

Open `http://localhost:3002/stream-test.html` for actual browser playback. Stop the test server with Ctrl-C when finished. The CLI and browser tests should be run sequentially; competing probe requests are refused. The CLI needs permission to inspect its own child processes for the RSS guard. It starts no speech or language service.

## Verification

Regression coverage checks integer sample ownership and context trimming, final-tail flushing, sentence caps, monotonic delivery schedules, bounded preparation/backpressure, strict playback acknowledgements, actual child termination, deadline/RSS enforcement, cross-process exclusion and local request boundaries. JavaScript coverage checks fragmented UTF-8/NDJSON, cue ownership, PCM scheduling, starvation accounting, cancellation, output-clock completion and mouth continuity. **35 Python and 59 JavaScript tests pass.** All original comparison methods remain; deferred pruning has not started.
