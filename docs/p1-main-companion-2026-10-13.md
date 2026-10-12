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
