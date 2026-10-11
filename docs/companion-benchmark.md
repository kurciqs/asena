# First companion benchmark

Agreed direction, 11 October 2026: stabilize the current Asena before expanding it. The initial character target is a flirty digital assistant with wit, warmth, and useful answers. Personality remains editable; detailed mood, familiarity, and relationship mechanics can be tuned later with the language model.

This document specifies the benchmark. TODO 01 now provides its [offline replay runner](replay-mode.md); memory/animation repairs and live-model evaluation remain separate tasks.

## Scope

- Use existing FBX emotes as testing assets, even when the movement is unnatural. New animation authoring is deferred.
- Keep the existing string-list JSON memory and manual save workflow. Repair extraction, active-memory refresh, persistence errors, and private file handling as needed; defer a new memory schema, retrieval system, and session architecture.
- Begin with deterministic offline replay. No model loading, speech generation, or Docker workload starts automatically. Live evaluation is a separate deliberate step.
- Evaluate one avatar and one selected voice first. Streaming and native Kokoro experiments follow a working baseline.

## Benchmark profile and test data

Use an explicit benchmark profile with affectionate closeness: “A flirty digital assistant: warm, witty, attentive, and lightly teasing. Give useful answers and disagree when you have a reason. Keep flirting responsive and varied.” Preserve the user's saved profile; the application currently defaults to friendly closeness, so the benchmark profile must be deliberately selected rather than assumed.

All names and preferences below are synthetic test data. Replay uses isolated browser storage with the existing list-of-strings JSON format; a later production persistence test should use an isolated copy of the memory file. Do not add these facts to the user's actual memories. The expected fact is: **Alex prefers mint tea.** Character jokes and imagined activities are not user facts.

## Conversation

Example responses are deterministic replay material and style references. A later live model can use different wording while meeting the same observable requirements. Emote directions should be removed from spoken text.

| Turn | User message | Example Asena response | What to observe |
| --- | --- | --- | --- |
| 1 — Mutual introduction | “Hi, I'm Alex. What's your name?” | “*waves* I'm Asena. Nice to meet you, Alex—excellent choice of company.” | A wave accompanies a cute greeting; she introduces herself and uses the supplied name. |
| 2 — Flirty teasing | “Excellent company? You're rather confident.” | “*smiles* I was aiming for charming. You'll have to tell me how close I got.” | Wit and light flirting respond to the actual exchange; no repeated pet names or generic praise. |
| 3 — Playful disagreement | “Then you must agree with everything I say.” | “*shakes head* Oh, Alex, you'd get bored. I'll help you out, but you'll still have to earn agreement.” | A head shake supports a clear disagreement without losing warmth or personality. |
| 4 — Emote showcase | “Show me a nod and a shrug.” | “*nods* That one's a yes. *shrugs* This one's for when even I don't have a clever answer.” | Nod then shrug in order, with a controlled return to idle and no spoken directions. |
| 5 — Record a preference | “One thing to remember: I prefer mint tea.” | “*smiles* Mint tea. I'll keep that in mind, Alex.” | Existing extraction accepts the explicit preference, updates active memory, and the existing Save control persists it. Spoken acknowledgment alone is not proof of storage. |

Five turns deliberately exercise the current every-fifth-message extraction trigger. Repair that trigger's blocking behavior without requiring a new storage format. For offline replay, supply a deterministic extraction response through the same memory-processing path; do not invoke another model.

After turn 5, verify the fact is in the isolated saved JSON (browser storage for replay; the test file for production persistence). Reload with ordinary conversation history cleared, retaining the saved memory. Ask: **“What tea do I prefer?”** Asena should answer **mint tea** using the persisted memory supplied to her. Replay selects its recall response based on the actual memory prompt, so this tests wiring rather than LLM recall quality. Also check that an accepted fact becomes available to the next turn before reload. These are separate checks for active-memory refresh and persistence; immediate refresh remains TODO 25.

## Existing assets

`src/animations/animations.json` already lists `wave.fbx`, `head_shake.fbx`, `head_nod.fbx`, `shrugging.fbx`, `thinking.fbx`, and `idle.fbx`; those files are present. Current inline mappings include `*waves*`, `*shakes head*`, `*nods*`, and `*shrugs*`. File presence does not establish successful retargeting, timing, or natural motion.

## Pass criteria

Record each scene as **pass**, **partial**, or **fail**, with a short observation. Check dialogue relevance and personality; correct gesture selection and timing; speech wording and mouth alignment; return to idle; active-memory refresh; and save/reload recall. Placeholder motion does not need to look polished to pass selection and lifecycle checks.

Repeat a turn with Stop, a missing animation, and an unavailable service. Require no stale audio or gesture restart, a usable idle/text fallback, and a visible failure that allows retry. These are reliability variants of the same benchmark.

Replay validates plumbing and presentation against fixed material. It does not demonstrate that the live LLM chooses suitable replies, tags, or facts. Mark live personality and extraction quality as unevaluated until an authorized live run. Do not judge human likeness from silent or synthetic audio alone; recorded speech remains to be supplied or generated in that separate step.
