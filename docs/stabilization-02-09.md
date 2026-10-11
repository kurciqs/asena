# Stabilization review: TODOs 02–09

Work is on `codex/stabilize-todos-02-09`. The baseline commit preserves the previous customizer, replay recordings, inspector, and backlog. Each completed TODO has its own subsequent commit. No LLM, Kokoro, or Docker workloads are started by this work. Tests use saved media and mocked services.

## TODO 02 — Turn ownership and cancellation

A turn controller invalidates prior turn IDs before aborting requests and releasing resources. Stop cancels fetch/audio loading, current playback, and queued gestures. A delayed response cannot update chat, memory, or playback after replacement. The chat displays requesting/preparing/speaking/stopped/failed states; the replay inspector contains the owning turn ID and state. Gesture timers and mouth actions are explicitly owned and released.

Verification: two controller tests cover delayed old results, replacement, abort, idempotent cleanup, and playback failure; eight replay tests still pass. Browser normal replay completed. Browser Stop verification was interrupted by browser automation timeouts and will be revisited during the final UI review. Jakub's visual confirmation remains pending; implementation completion does not claim that approval.

## TODO 03 — Asset loading and fallback

Replaced the asynchronous forEach/poll loop with deadline-bound loads. Idle is attempted first, then at most three optional FBX conversions run together. Missing gestures are skipped; missing idle uses the rest pose. Avatar replacement commits only after its assets settle, with a generation check preventing old loads from replacing newer selections. The previous usable avatar survives a failed replacement. Late timed-out GLTF results are disposed. Loading errors, requested/current model, missing clips and elapsed milliseconds are exposed in the inspector and original settings.

Verification: offline tests exercise a rejected clip, a clip that never resolves, idle-first ordering, superseded loads, and disposal of a late model after timeout. Existing turn cancellation tests pass. Visual evaluation of arbitrary custom avatars remains a user review item.

## TODO 04 — Lossless parsing and normalized anchors

Known single-star directions are removed and anchored in normalized spoken text. Other paired-star text keeps its words, bold emphasis keeps its content, and unmatched or escaped delimiters are not silently discarded. Numeric multiplication syntax is preserved. The duplicate `sighs` mapping now intentionally produces a sad emotion and a sigh gesture. Kokoro punctuation tokens are matched against compact normalized text rather than guessed spaces. Multiple cues at an anchor and trailing gestures are retained; unavailable gestures are filtered. Nonmatching speech/timestamps fail explicitly instead of inventing timing.

Regression cases: leading/repeated whitespace; tags at the beginning, between words and at the end; emphasis; unknown starred words; unmatched delimiters; multiplication stars; commas/full stops/em dashes returned separately; contractions; multiple cues at one anchor; dual-channel sigh; empty word timings; unavailable names; nonfinite and mismatched timings. Three parser regressions and all eight existing replay tests pass.

## TODO 05 — Expression tracks and playable audio

Mouth cues sharing a VRM channel now merge into one bounded track, resolved against expressions actually present on the avatar. Times are unique and sorted, overlapping contributions use their maximum rather than competing tracks, and rest closes mouth channels instead of activating the neutral face. Empty cues safely reset available channels. Invalid timings fail before animation construction. Live audio waits for finite duration metadata, and Kokoro WAV placeholder lengths are repaired without changing PCM samples. Playback rejection releases the turn's resources.

Verification: three new tests cover aliased expression channels, empty/missing bindings, malformed timing, WAV payload preservation, and cancellation during metadata loading. All 18 JavaScript tests pass. Existing approximate viseme mapping and happy intensity remain unchanged; appearance tuning is deferred under TODO 20a.
