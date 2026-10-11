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

## TODO 06 — Bounded failures and retry

The server validates chat/speech payloads before contacting services, limits response bytes, applies connection/read timeouts and a response deadline, preserves unsuccessful upstream HTTP statuses, and validates successful replies. Audio conversion and Rhubarb each have 30-second deadlines. Missing services/tools return useful retryable errors without their private response bodies. The browser bounds the entire request/body read and offers Retry; a speech retry reuses the already visible reply. Live alignment/timestamp failures allow neutral audio playback. Explicit replay error cases remain strict so failures stay testable. Memory extraction failure no longer discards a usable dialogue reply; extraction timing itself remains TODO 25.

Verification: five backend regressions exercise invalid inputs without network access, upstream 503, refused connections, timeouts, oversized/deadline responses, malformed JSON/replies/audio, missing timestamps, and subprocess timeout/missing tool. Ten Python tests pass. A browser-client test exercises HTTP errors, unreadable responses, deadline cancellation and Stop cancellation without real services. Service response deadlines are checked between chunks; socket reads are additionally bounded to 30 seconds. No inference workloads were started.

## TODO 07 — Private storage and contained writes

Memory retains the existing string-list format and manual Save control, now through `/api/memories`. Files live in ignored `.runtime/`, outside static assets, with private file permissions and atomic replacement. This checkout's two existing memories were copied, compared exactly, and removed from the public folder; old generated WAV files were preserved in `.runtime/legacy-audio/`. Future old checkouts import their legacy memory once on a live memory read. Public replay fixtures remain public, synthetic benchmark material. Earlier Git history is unchanged and may still contain the old memory file; the current branch no longer tracks it.

Audio uploads accept only bounded PCM16 WAV data and receive random server-issued IDs. Alignment consumes each private resource and removes it in a finally block; Stop/completion also release IDs. Lost responses are bounded by a 10-minute expiry, 32-resource count and 64 MiB pool limit. Alignment is single-flight. Old arbitrary filename endpoints return 410. Static memory routes, traversal, foreign origins and non-loopback hosts are rejected; private API responses are not cached. No permissive CORS remains. This is a local server; remote website hosting needs explicit authentication/TLS and is outside the supported setup. A separately configured remote inference endpoint does not expose this website.

Verification: five new tests cover interrupted atomic replacement, legacy import, bad memory types, path injection, unique/expired/capacity-limited audio IDs, cleanup after alignment timeout, private static paths, cross-origin access and rebinding hosts. All 15 Python tests pass. No personal memory contents were logged or committed.

## TODO 08 — Conversation budget

Requests now reserve reply capacity, merge profile/memory into one initial system message, and retain only whole recent dialogue turns that fit. Profile input has a fixed allocation; oversized settings or the newest turn fail visibly before inference rather than silently losing user limits. Most recent complete memory strings are selected within a separate allocation; the stored archive and displayed dialogue are unchanged. Each new request packs current accepted memories/profile settings, so they can affect the next reply immediately. Dialogue and extraction usage are stored separately. The visible meter reports the active input bound, output reserve and omitted messages, with actual last dialogue prompt usage in its tooltip when supplied by the service.

The count is a deliberately conservative NFC UTF-8 byte bound plus 64 per message and 256 for template overhead, not an exact tokenizer count. Default capacity is 8192 with 512 reserved for output; configure it to match or stay below the context actually loaded in LM Studio. The current text-only Qwen tokenizer uses byte-level BPE ([primary implementation](https://github.com/huggingface/transformers/blob/main/src/transformers/models/qwen3_5/tokenization_qwen3_5.py)); the padding is our engineering allowance. A different tokenizer/template must be checked before relying on the bound. No tokenizer/model was loaded. The server independently rejects input/output overflow. Summarization remains deferred; this implementation trims whole turns.

Verification: three JavaScript cases cover 100-turn history trimming, whole-turn order, output reserve, Unicode memory bounds, too-large profile/newest-turn rejection and next-request profile/memory refresh. Two backend cases ensure overflow never reaches a service and the default reply reserve is applied. All 17 Python tests and relevant replay/budget tests pass.
