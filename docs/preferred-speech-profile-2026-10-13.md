# Preferred speech profile and stabilization plan — 13 October 2026

## Accepted baseline

Keep **1-second opening analysis / 2-second later analysis / at least 2 seconds of prepared audio before playback**. Jakub reports this is the most stable combination across all eight trial categories. The completed S06 trial visible when recording this decision used **sentence/long-clause generation**, lasted **28.41 seconds**, and had **zero playback gaps**. It reached first playback at **9.25 seconds**, with approximately **5.81 seconds** of Kokoro generation before first bytes and **3.17 seconds** of Rhubarb before playback. [Captured user trial](evidence/preferred-122-user-trial-2026-10-13.json).

This is a user-selected baseline supported by that saved run, not a guarantee that every future turn or computer load will be gap-free. The reported all-category listening result is attributed to the user; only the visible completed S06 run was captured here.

## Modular implementation

`speech_profiles.json` is the single profile catalog. Its default is **stable-122**, including the selected sentence-generation mode. Add experimental profiles under a new name and update the catalog version when changing policy. Select a different named profile with `ASENA_SPEECH_PROFILE`; importing configuration starts no services. Invalid settings fail at startup rather than silently changing the buffer policy.

Both servers expose the selected profile: `/runtime` for the companion and `/probe/health` for the diagnostic viewer. The companion forwards it to the speech adapter; API requests that omit settings use the same backend defaults. The viewer initializes its controls from that profile. Each requested setting can still be overridden separately; begin/completion metadata identify the effective profile as `stable-122` or `custom` and include its version, text strategy and actual settings. Settings are resolved when a turn starts.

The profile controls text-request planning and audio-buffer/analysis policy; implementation boundaries remain separate:

- **Text planner:** sentence/long-clause or previous-fragment strategy.
- **Kokoro transport:** streaming NDJSON, validated mono PCM16 at 24 kHz, optional bounded captions.
- **Audio timeline:** integer sample offsets and bounded retained audio.
- **Rhubarb adapter:** native acoustic analysis plus retained-region cue trimming.
- **Playback/character:** shared audio clock, buffering state and mouth/gesture/expression tracks.

The 2-second reserve is a minimum. With a 1-second opening and later 2-second regions, playback can start after 3 seconds of prepared audio because whole aligned regions are delivered; short finalized text-request tails can change that amount. It is not an exact 2-second intentional delay. The 250 ms analysis context remains separate. Saved recordings continue to bypass generation and fresh alignment.

The main companion still requires streaming to be explicitly enabled and its server to be restarted to pick up updated configuration. No LLM or new speech generation was run for this change. The existing authorized Kokoro remains running for the user's tests.

## Next work, in order

### 1. Stabilize the companion loop with the selected profile

The test viewer starts from fixed text. Verify the same profile through assistant reply → stage-direction parser → speech requests → regional Rhubarb → expressions/emotes → memory. Begin with saved/captured provider responses and mocks. Separately coordinate a short live LLM trial once the machine is prepared.

Use the agreed introduction, teasing, disagreement, emote and recorded-memory scenes. Exercise Stop before audio, Stop during speech, rapid replacement, Pause/Resume, a provider disconnect and stalled delivery. Confirm no stale audio/mouth/gesture events, no brief T-pose, bounded incoming/prepared queues, and released audio/worker resources after each turn. Existing tests cover several of these mechanisms; real companion acceptance and repeated-turn resource measurements remain required.

### 2. Make LLM speech wording suitable for the accepted transport

Keep a **short complete opening sentence**, then short complete sentences with natural clause boundaries. Avoid forcibly cutting a sentence after an arbitrary word; the first “you” in S06 demonstrated why. Preserve facts, numbers and the user's intended meaning. Keep emote/emotion metadata out of spoken words. Prompt-policy work belongs to TODO 13, with named sample listening review before deciding production wording constraints.

This is likely the highest-impact first-playback optimization in the captured S06 run: Kokoro's generation wait was larger than Rhubarb's startup work. Compare an unchanged longer opening against a short complete opening with the same voice/profile under comparable host memory/load. Do not assume that changing an analysis-region size speeds synthesis.

### 3. Reduce Rhubarb setup overhead without changing its accepted algorithm

Prototype **one lazy, serialized decoder worker**, started only for an explicit speech turn. Reuse acoustic setup across regions, reset per-request dialogue bias, cap retained state, and give the worker an idle expiry. Cancellation, deadline and memory-limit violations must terminate the complete owned worker. Keep the existing process-per-region implementation selectable for rollback and compare cues on the same saved WAVs.

The earlier finite-batch prototype saved roughly .26 seconds per short job; that is evidence for trying reuse, not a production latency guarantee. The 1–2–2 profile often needs two alignment jobs before playback, so reducing repeated setup can help both startup and sustained headroom. Verify cue equivalence and long-session memory before installation.

### 4. Tune Kokoro internals separately

Trial lower provider-side phoneme-token targets while retaining complete sentence/clause context. A single streaming HTTP request still waits for its first inference chunk; an oversized S06 request exceeded the existing container memory budget. Measure first byte, packet sizes, inference peaks and listening quality before selecting another provider configuration. Native MPS remains a separate prepared experiment, not a requirement for stabilizing the existing Docker pipeline.

### 5. Record repeatable acceptance results

Keep 1–2–2 fixed while comparing one optimization at a time. Record profile/version, voice, text strategy, provider image, cold/warm state, host memory/swap, first packet, first playback, minimum prepared reserve, gaps, and resource use. Repeat the existing S01–S08 cases and the companion benchmark under comparable conditions. Proposed acceptance: no gaps in prepared-machine baseline trials, no stale events after Stop, cue-quality acceptance, and no growing retained resources across repeated turns. Exact latency targets should be set from those measurements.

If necessary, introduce an explicit refill reserve for recovery after a stall. The current 2-second threshold gates initial playback; after starvation the player schedules the next aligned region immediately. Keep adaptive policies as a separate named experiment after the fixed baseline is accepted.

## Scope and checks

The preferred profile is implemented now. The worker reuse, LLM prompt changes, provider tuning, adaptive recovery and new live trials above are follow-up work. Existing comparison methods remain available under deferred TODO 11b. Offline verification checks canonical defaults, named profile selection, invalid configuration, overrides, report metadata and companion request forwarding; mock stream tests use private ownership locks so they cannot disrupt the user's live test.

**Verification:** 57 Python tests and 74 JavaScript tests passed. The updated viewer was checked for its named profile and 1–2–2 controls without pressing Start or generating new audio.
