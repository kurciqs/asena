# P1 speech stabilization and main-interface preparation — 13 October 2026

## Step 13 and the brought-forward memory repair

The accepted `stable-122` profile remains unchanged: one-second opening Rhubarb region, two-second later regions, two-second minimum startup reserve, and sentence/long-clause Kokoro requests. Text boundaries remain separate from audio/mouth-analysis boundaries. The existing parser strips only recognized directions before speech.

The companion prompt now requests a short complete opening (usually 6–12 words) followed by short complete sentences. These are wording instructions, not a semantic truncation algorithm. Their effect on a live model and audible delivery must be judged in the next thread.

Every fifth response previously performed another LLM request before showing/speaking the reply. Extraction now runs **after speech**, uses one bounded immutable snapshot of the last ten dialogue messages and an independent factual instruction, and retains pending work if a new foreground turn interrupts it. New accepted strings are deduplicated, bounded to the existing storage limits, and immediately available to context packing. The existing string-list format and manual Save remain. Extraction still requires a completed foreground turn to drain; this is deliberately not an autonomous background model scheduler.

Offline checks cover the real fifth-turn ordering, cancellation during extraction, stale-result rejection, snapshot immutability and atomic limit rejection. **77 JavaScript tests passed at this step.** No language model or new speech was run.

LLM token streaming remains a separately coordinated follow-up. Start with completed short replies and the accepted streamed speech path; do not overlap resident LLM/TTS workloads until measuring their combined memory budget.

## Step 14: main chat, preview and explicit fallback

`ASENA_MODE=preview` uses the original draggable chat, companion controls, five scripted benchmark replies and memory recall. The backend blocks `/chat`, batch generation/alignment and private-memory endpoints. Preview memories and profiles remain in isolated browser storage. `ASENA_SPEECH_SOURCE=recorded` feeds fixed stored PCM and Rhubarb cues through the **same** regional protocol/player used for live speech, without fresh Rhubarb, TTS, or simulated generation delays. The accepted profile controls buffer/region packaging; these are playback checks, not live latency measurements. `ASENA_SPEECH_SOURCE=kokoro` instead runs the current actual Kokoro/Rhubarb transport when the user presses Play scene. Neither mode starts services.

Normal live conversation and preview now expose Debug, including collapsible current-turn JSON. Stream warnings and completion/failure reports reach that interface. If speech fails after partial playback, the owned player/character stop, the full text stays visible, and the warning explains that explicit Retry restarts voice from the beginning. No automatic second provider request repeats words already heard. Complete-WAV playback remains a server configuration rollback; it is not silently selected after a partially spoken failure.

Recorded-preview tests exercise every benchmark/recall fixture, exact sample coverage, stored cue trimming, unsupported text rejection, and backend blocks without provider/subprocess calls. A browser check completed the introduction and teasing using the main PCM loop. A wait for the first completion exceeded the browser tool's short action deadline; the next observation showed successful completion with no browser errors. This was an observation timeout, not a speech failure.

## Step 15: resource lifetimes

The stream registry now retains ownership until **both** the recognizer worker and provider reader exit. The alignment lock is released with that ownership, preventing another turn from starting while a delayed old provider still exists. Released streams discard PCM, caption/request-boundary buffers, captured protocol and pending delivery frames. Completed/stopped browser sources clear their buffer and event handler, and full-WAV/replay cleanup detaches the audio source as well as revoking owned Blob URLs. Cancellation sends at most one explicit provider-control request.

New regressions cover 30 serial backend turns, a deliberately delayed provider exit, exclusive stream ownership, and 50 completed/cancelled browser-player turns with zero retained buffers, source nodes or cues after Stop. Existing tests cover stale tokens, unconsumed responses, provider socket shutdown, private-file cleanup and queue bounds. **61 Python and 79 JavaScript tests passed at this step.**

Additionally, six serial **native Rhubarb** turns analyzed the same already captured 4.29-second PCM clip (18 regions) with unchanged sample hashes. Each exited with zero retained worker threads, PCM queue bytes or stream owners. [Measured evidence](evidence/speech-lifetimes-native-2026-10-13.json). Immediate sample acknowledgements deliberately isolate worker/resource lifecycle; these times are not audible or live-generation latency. The small test does not establish combined LLM/TTS capacity or a long-session browser heap plateau.

The browser main-chat introduction, teasing, disagreement and emote showcase ran through saved PCM/cues. Pause visibly changed the emote scene to Paused/Resume without restarting the turn. Placeholder gesture quality and the happy-mouth visual issue remain P2 tuning.

## Step 16: diagnostics in the intended interface

The main-chat inspector now exposes a per-turn report: immutable mode/source/profile/voice/model settings, first complete text, parsing, gesture preparation, speech request, estimated first audible output, memory extraction, queue state, completion/failure and resource cleanup. It uses the viewer's shared startup-breakdown component for Kokoro connection/headers/generation, packet receipt, regional Rhubarb, buffer wait and browser scheduling. Reports remain local and downloadable; PCM and control tokens are omitted.

The stream player's first-output timer now starts **before browser audio setup and the HTTP request**, rather than when the first format frame arrives. This matters in the main adapter: the earlier constructor-relative timer omitted most of the initial Kokoro wait. The diagnostic viewer already included that earlier interval. Reports explicitly leave service/model boot, isolated Kokoro inference and combined LLM/TTS peak memory unmeasured.

The final saved-PCM introduction completed with a short pause/resume cycle and a downloaded report: [main-interface evidence](evidence/main-preview-turn-2026-10-13.json). It estimated first voice at **0.292 seconds** after submission, including approximately **0.158 seconds** for a first-use gesture. Cleanup reported zero blocks, buffers, nodes and cues, with the audio context closed. This is direct saved playback, **not a new live latency improvement**.

A deliberately long pause in an earlier preview hit the three-minute stream lifetime. The backend originally could not send its timeout event because sending that event checked the expired deadline again. Terminal error delivery now has its own bounded one-second delivery attempt and preserves the timeout reason/report. A regression covers that path. The three-minute lifetime continues while paused; it is a bounded-turn policy, not an indefinitely resumable session.

Additional cancellation fixes prevent a delayed stopped turn's final cleanup from stopping its replacement, cancel frame/ack callbacks immediately, and make a blocked browser-audio resume abortable. Current verification: **63 Python and 82 JavaScript tests passed**, plus a read-only preview preflight with zero blocking issues. No LLM or new Kokoro synthesis was run for these changes. Native Rhubarb tests used saved PCM only.

The preview's **Voice for the next scene** selector offers saved voice by default. The live Kokoro option appears only when explicitly enabled in server configuration (`ASENA_PREVIEW_KOKORO=1` or Kokoro as the configured preview source), and starts generation only when a scene is played. The backend rejects a browser attempt to enable a disabled source. Voice/source/profile choices are captured at turn start; changing a selector cannot alter a running turn.

## Remaining deliberately coordinated work

The selected speech architecture and speech-side P1 implementation are complete. Original LLM text-streaming and combined model/speech acceptance are explicitly retained as follow-ups, rather than claimed by fixture tests. Comparison cleanup remains deferred under 11b. Resident Rhubarb decoder reuse, provider token tuning and native MPS remain isolated optimizations with quality/memory gates; none is required to use the accepted baseline and none was silently deployed.

**Move to a fresh chat before live LLM integration.** Use the [handoff](llm-integration-handoff-2026-10-13.md) for configuration, preparation and acceptance. Qwen's existing model file was checked against the locked 1,280,835,840-byte download and SHA-256; it matches. [Read-only file evidence](evidence/llm-preparation-file-check-2026-10-13.json). The check read the file; it did not load a model or call inference.
