# P1 speech stabilization and main-interface preparation — 13 October 2026

## Step 13 and the brought-forward memory repair

The accepted `stable-122` profile remains unchanged: one-second opening Rhubarb region, two-second later regions, two-second minimum startup reserve, and sentence/long-clause Kokoro requests. Text boundaries remain separate from audio/mouth-analysis boundaries. The existing parser strips only recognized directions before speech.

The companion prompt now requests a short complete opening (usually 6–12 words) followed by short complete sentences. These are wording instructions, not a semantic truncation algorithm. Their effect on a live model and audible delivery must be judged in the next thread.

Every fifth response previously performed another LLM request before showing/speaking the reply. Extraction now runs **after speech**, uses one bounded immutable snapshot of the last ten dialogue messages and an independent factual instruction, and retains pending work if a new foreground turn interrupts it. New accepted strings are deduplicated, bounded to the existing storage limits, and immediately available to context packing. The existing string-list format and manual Save remain. Extraction still requires a completed foreground turn to drain; this is deliberately not an autonomous background model scheduler.

Offline checks cover the real fifth-turn ordering, cancellation during extraction, stale-result rejection, snapshot immutability and atomic limit rejection. **77 JavaScript tests passed at this step.** No language model or new speech was run.

LLM token streaming remains a separately coordinated follow-up. Start with completed short replies and the accepted streamed speech path; do not overlap resident LLM/TTS workloads until measuring their combined memory budget.
