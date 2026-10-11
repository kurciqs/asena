# Asena implementation checklist

Created 11 October 2026 from the current architecture audit, July–August 2025 Git history, your Asena project note, and earlier prototypes. Full evidence, historical status, Ani comparison, and research: [architecture health check](/Users/kurciqs/Documents/coding/sayuri/asena/docs/architecture-health-check-2026-10-11.md).

This backlog combines existing foundations and implementation work. An unchecked item may extend an existing prototype. “Then” refers to the recovered H01–H14 historical goals in the report; “now” refers to newly identified architecture or companion requirements. Items have acceptance criteria so they can be closed based on working behavior.

**Development constraint:** use offline fixtures first. Do not automatically start/download language models, TTS, speech recognition, or Docker workloads. Agree on a small live test separately when resource use is understood.

**Agreed first milestone:** a quick mutual introduction, an emote showcase, a flirty personality showcase (including witty teasing and warm disagreement), and at least one saved memory recalled after reload. Use the existing emotes and string-list JSON memory. Stabilize those paths before introducing new memory storage or detailed character state. Concrete scenes and checks: [companion benchmark](docs/companion-benchmark.md).

## Existing foundations to preserve

- [x] Live Three.js / three-vrm avatar renderer replaced the earlier application/video-rendering approach. This does not mean animation coordination is complete.
- [x] Basic chat UI, model/animation selectors, and Kokoro voice picker exist.
- [x] Rhubarb and approximate dictionary lip-sync paths exist. Streaming and timing quality remain open.
- [x] Inline actions/emotions and beta memory extraction exist. Reliability and memory continuity remain open.
- [x] Basic installation instructions and local asset indexes exist. Fresh-clone reproducibility remains open.
- [x] Current working tree has editable name, personality, relationship notes, preferences, and friendly / affectionate / intimate modes with browser persistence. This remains prompt-level customization.

## P0 — Stabilize before expanding

- [x] **01 — Add an offline replay mode.** Origin: now; supports all historical debugging pain points. Use synthetic or saved text, audio/timestamps, and missing/error fixtures without inference. **Done when:** the full turn can be inspected with all AI services stopped, and tests cannot silently fall through to a real backend. **Implemented 11 October 2026:** separate server-owned replay mode, five benchmark scenes, seven saved Kokoro clips with word timestamps and Rhubarb mouth cues, service and missing-data cases, turn inspector, isolated test profile/memory, and server-side backend/write blocking. Thirteen automated checks pass; browser playback, save/reload recall, chat failure, and missing audio verified. [Usage and limitations](docs/replay-mode.md).

- [x] **02 — Give each turn a single owner and cancellation path.** Origin: now. Track requesting, preparing speech, speaking, stopped, and failed states; own active audio and gestures; use aborts and turn IDs. Add a visual debugging display for admin work. **Done when:** a new/stop action halts previous audio and motions, clears queued events, and late responses cannot restart them. Visual board is checked and confirmed by Jakub. **Implemented:** turn IDs, abort signals, owned audio/gesture cleanup, Stop control, visible lifecycle status, and stale-result guards. Controller race/cleanup tests pass; final visual confirmation by Jakub remains pending.

- [x] **03 — Repair model/animation loading and missing-clip fallback.** Origin: then H10, now. Await loads, remove endless polling, load idle first, guard model swaps, and register listeners once. Display loading times for debugging. **Done when:** a missing clip or rapid avatar switch leaves a usable character and no stale load can replace the selected model. **Implemented:** bounded idle-first loading with three optional-clip workers, rest-pose fallback, atomic avatar swap, stale/timed-out model disposal, one-time listeners, and visible errors/timings. Tests cover stalled/missing clips and late completion.

- [ ] **04 — Make speech and performance parsing lossless.** Origin: then H03, now. Fix duplicate mappings, unknown starred text, whitespace offsets, punctuation, multiple/trailing cues, and unavailable names. **Done when:** speech wording survives emphasis, cues have explicit normalized anchors, and malformed/unknown directions cannot crash or remove ordinary words. Generate a list of edge cases to verify the parsing algorithms on.

- [ ] **05 — Correct mouth/expression track construction.** Origin: then H02, now. Merge cues targeting the same VRM channel, validate finite sorted times, resolve actual expression bindings, await playable audio, and handle playback rejection. **Done when:** one track controls each expression property; empty/missing cues and unready metadata have a safe fallback.

- [ ] **06 — Make service failures visible and bounded.** Origin: now. Validate payloads, propagate upstream status, set network/subprocess deadlines, and show retryable UI errors. **Done when:** unavailable LM/TTS/Rhubarb services do not hang the turn; usable text remains visible and speech can fall back appropriately.

- [ ] **07 — Contain writes and private data.** Origin: now; prerequisite for H14 desktop hosting. Replace client paths with server-owned resource IDs; move memory/audio outside static assets; validate sizes/types, use atomic writes, constrain origin access. **Done when:** traversal is rejected, personal data is not a public static route, and any remote-access deployment has explicit access controls.

- [ ] **08 — Enforce a conversation token budget.** Origin: then H04/H06, now. Configure context capacity, reserve output space, trim/summarize older turns, bound profile/memory allocation, and separate extraction usage from chat usage. Add visual indicators. **Done when:** long sessions stay within the configured limit and the meter describes the active dialogue.

- [ ] **09 — Make configuration and setup reproducible.** Origin: then H09/H10/H12/H13. Pin Python/browser dependencies and backend versions; centralize endpoints/model/paths; document exact asset downloads and FBX conversion; correct stale README promises. **Done when:** a clean checkout has a documented fixture-only start, useful missing-asset checks, and no dependence on undocumented local files. Vendor frontend dependencies/fonts if fully offline operation is selected.

- [ ] **10 — Add independent startup and low-power rendering.** Origin: then H14, now. Bootstrap UI before optional data/renderer; lazy-load dictionary/assets, cap pixel ratio, make shadows optional, resize on change, and throttle hidden tabs. **Done when:** settings/text chat remain usable after a missing memory/dictionary/WebGL resource, and reduced-quality mode avoids unnecessary continuous work. Visual check by Jakub needed to confirm no quality was lost.

## P1 — Make speech responsive and synchronized

- [ ] **11 — Build one audio-clock performance scheduler.** Origin: then H01/H02, now. Own a bounded segment queue; use played-audio time for mouth, emotion, and gesture events. **Done when:** pause, resume, stalls, and stop affect every channel together; chunks neither overlap nor drift due to independent timers.

- [ ] **12 — Validate and implement captioned speech streaming.** Origin: then H01. Check the installed Kokoro contract against a pinned version; forward framed audio/timestamps through the server and parse arbitrary network boundaries. **Done when:** captured/synthetic protocol fixtures stream correctly, partial errors are handled, and first audio does not require the entire response. See the report for current upstream capabilities.

- [ ] **13 — Add bounded speech segmentation and later text streaming.** Origin: then H01/H07. Preserve sentence/prosody boundaries, normalized spoken text, and independently valid performance records. **Done when:** a first usable segment can be scheduled without parsing the complete response; partial tags/JSON never reach TTS. On constrained hardware, start with short complete text followed by streamed speech; overlap LM/TTS only after budgeting their resident memory.

- [ ] **14 — Provide online lip sync with an explicit quality fallback.** Origin: then H02. Correct dictionary word normalization/rest timing, support unknown words, and compare lightweight timestamp-driven mouth motion with Rhubarb. **Done when:** speech starts without waiting for full Rhubarb analysis, while the offline higher-quality path remains available. Do not equate phoneme sequences with measured durations.

- [ ] **15 — Bound audio/file/object lifetimes.** Origin: now. Release Blob URLs, completed buffers/actions, cancelled segments, and per-turn temporary files; avoid the single shared `tts.wav`. **Done when:** repeated replay and multiple sessions do not overwrite each other's audio or steadily retain completed resources.

- [ ] **16 — Measure latency and resource use deliberately.** Origin: then H14, now. Record first text, first playable audio, completion, alignment, extraction, queue depth, and memory pressure. **Done when:** a baseline and budget are recorded for each chosen deployment, using a separately authorized short live test. Published backend benchmarks are not this laptop's measurements.

## P2 — Build a coherent, customizable character

- [ ] **17 — Create persona presets and example conversations.** Origin: then H06/H07, current customization request. Start with an editable flirty digital assistant baseline and the benchmark's witty teasing, cute greeting, and warm disagreement; tune the prompt/model after the current loop is reliable. Later add editable interests, opinions, humor, speaking style, and examples for casual, comforting, affectionate, and intimate conversation. **Done when:** two different profiles feel distinct across the same scenes, remain consistent, and avoid recurring stock openers/pet names/questions.

- [ ] **18 — Separate personality, mood, reaction, and interaction phase.** Origin: now. Use small explicit state with temporal decay and bounded changes; persist only appropriate continuity. **Done when:** the character reacts to context without changing personality every sentence and visibly distinguishes listening, thinking, speaking, and interruption.

- [ ] **19 — Replace free-form tags with a validated behavior contract.** Origin: then H03. Check structured-output support for the chosen model/backend; define available cue enums, bounded intensity, anchors, and a neutral fallback; enforce cooldowns in code. **Done when:** invalid labels are contained and socially inappropriate but syntactically valid cues are caught by policy/evaluation. Avoid another permanently loaded classifier model.

- [ ] **20 — Author a small motion library with layered blending.** Origin: then H03/H10/H12. First use existing wave, head shake, nod, shrug, thinking, and idle clips as testing placeholders; defer judging their naturalness until playback is stable. Later curate idle/listen/think, greeting, nod, shrug, amused reaction, reassuring motion, and optional affectionate variants; define masks, root motion, and return-to-idle. **Done when:** replay scenes have deliberate transitions and gestures can coexist with gaze/mouth motion without snapping or repetitive full-body loops.

- [ ] **20a — Fix happy-expression mouth distortion during speech (deferred visual polish).** Origin: user observation, 11 October 2026; related to task 05's mouth/expression tracks and task 20's layered blending. **Observed:** `happy` while talking stretches the mouth unnaturally and makes it too open. Investigate how the happy expression combines with speech mouth shapes, then adjust expression weights/blending without losing the smile or lip sync. **Done when:** the same saved speech clip looks natural with both neutral and happy expressions, without excessive mouth opening/stretching; visually confirmed by Jakub. Defer this visual tuning until the current pipeline is stable.

- [ ] **21 — Make gaze, blinking, and idle behavior responsive.** Origin: then H11, now. Use elapsed time rather than frame counts, one blink timer, closed-eye expression coordination, attention targets, and restrained posture variation. **Done when:** behavior stays consistent at different frame rates and responds to listening/speaking rather than following an unconditional sine wave.

- [ ] **22 — Connect character style to supported voice delivery.** Origin: then H07, now. Persist voice/pacing preferences and map delivery intent to backend-supported controls; evaluate contextual/expressive speech as a later isolated experiment. **Done when:** a warm or playful scene has fitting audible delivery, unsupported controls degrade predictably, and tags are not spoken aloud.

- [ ] **23 — Keep chosen closeness separate from familiarity.** Origin: current customizable companion request; Ani experience target. Apply friendly / affectionate / intimate preferences to dialogue and optional delivery/animation; track familiarity through actual interaction. **Done when:** current preference changes take effect immediately, old history cannot force escalation, and continuity can grow without overriding the chosen mode.

## P3 — Make memory useful across sessions

New schemas, retrieval, and session architecture in this section are deferred until the existing version is stable. The first milestone retains the string-list JSON and manual Save control; fix active-memory refresh, save/reload reliability, and task 07's private file handling within that format. Task 25's timing/refresh repair remains part of stabilization.

- [ ] **24 — Define source-backed memory records.** Origin: then H04. Store kind, source turn/date, explicit/inferred status, correction/supersession, and salience; separate user facts, shared conversational events, and fictional character background. **Done when:** extracted facts can be traced to evidence and roleplay cannot silently become a factual shared past.

- [ ] **25 — Refresh memory immediately and remove extraction from the speech path.** Origin: then H04, now; bring this forward into P0/P1 work. Rebuild/select active memory when records change; summarize only the intended turns with a factual instruction after foreground work. **Done when:** a new accepted fact is usable next turn without reload and every fifth reply has no compulsory extra model call before speech. Serialize or postpone extraction on the laptop.

- [ ] **26 — Retrieve and maintain a bounded memory set.** Origin: then H04/H05. Start with lightweight relevance/recency retrieval, deduplication, correction, and token limits. **Done when:** relevant facts surface in a long history without injecting the entire archive; contradictions and stale preferences resolve explicitly. Add embeddings only if measured retrieval needs justify the resource cost.

- [ ] **27 — Persist sessions and memories reliably.** Origin: then H04. Add per-character/session IDs, autosave, atomic versioned storage, migration from the string list, and visible save failures. **Done when:** reload restores dialogue and accepted facts, profile changes do not cross-contaminate characters, and interrupted writes preserve the last valid state.

- [ ] **28 — Add inspect, correct, forget, export, and reset controls.** Origin: now. Make memory and profile/session persistence understandable in the UI. **Done when:** a corrected or forgotten fact no longer appears in retrieval, exported data is usable, and resetting one character does not erase another's data.

## P4 — Enable spoken interaction within the resource budget

- [ ] **29 — Add push-to-talk transcription first.** Origin: now; Ani experience target. Show microphone state, editable transcript, and an explicit submit/stop path. **Done when:** ordinary speech enters the existing controller, microphone access ends predictably, and denied/unavailable access leaves typing usable. No automatic STT model loading.

- [ ] **30 — Add selective interruption and end-of-turn handling.** Origin: now. Handle echo/noise, true interruptions, mid-thought pauses, and acknowledgments separately; evaluate a semantic endpointer only after the simpler loop works. **Done when:** replay voice scenes yield appropriately, “mm-hmm” does not always cancel output, and stale audio/gestures cannot resume after a real interruption.

- [ ] **31 — Define supported deployment/resource profiles.** Origin: then H09/H14. Document constrained-laptop and stronger-desktop configurations, explicit service lifecycle, memory limits, and a private remote connection if chosen. **Done when:** users can select a known configuration without source edits, opening the site loads no models, and concurrency limits account for resident model memory as well as active compute. Native Apple acceleration is a candidate to verify, not an assumed speedup.

## P5 — Approach Ani's presentation and richer companionship

- [ ] **32 — Curate appearance, scene, camera, and optional recording.** Origin: Ani target / original visual goals. Build an Ani-inspired adult companion preset, polished framing/lighting, user-selected outfits/backgrounds, optional quiet ambience, and later clip export. **Done when:** one cohesive scene looks and moves intentionally, selections persist, and ambience/recording have clear controls. Keep the current customizable VRM architecture.

- [ ] **33 — Add optional familiarity/progression feedback.** Origin: Ani user-report reference. Hearts, subtle reactions, or relationship labels can reflect interaction state. **Done when:** effects are optional, meanings are clear, and progression remains independent of the user's current closeness and appearance choices. Exact Ani thresholds/formulas remain unverified.

- [ ] **34 — Add small persistent interests and shared routines.** Origin: new companion continuity goal. Use explicit topics, unfinished conversations, favorite activities, and bounded in-app initiative. **Done when:** a later conversation can naturally continue a real shared topic without fabricated offline activities or repetitive unsolicited check-ins. Background reminders require a separate user request.

- [ ] **35 — Expand language support end to end.** Origin: Ani user-report reference. Match dialogue, voice, text normalization, pronunciation, timestamps, and mouth mapping for each selected language. **Done when:** an evaluated non-English scene works through the full pipeline rather than relying on the English CMU dictionary.

- [ ] **36 — Consider optional shared activities/tools after the companion loop works.** Origin: new expansion option; deferred. Start with a bounded activity such as a story or simple game that fits the character. **Done when:** activity state survives the session and improves companionship without disrupting speech timing. External account integrations are outside the first milestone.

## Evaluation — Start now, reuse throughout

- [ ] **37 — Establish reference scenes and a human-rating rubric.** Origin: now. The initial [benchmark specification](docs/companion-benchmark.md) covers mutual introduction, emote and flirty personality showcases, witty disagreement, and a saved preference recalled after reload. Implement those scenes first, then expand to comfort, closeness changes, memory correction, interruption, and failure; record observable Ani targets and evidence confidence. **Done when:** changes can be compared for persona specificity, consistency, repetition, memory accuracy, timing, voice appropriateness, and audiovisual agreement. Fixed replay material does not establish live model quality. Historical Ani reports are not undocumented current implementation claims.

- [ ] **38 — Run long-session regression and bounded model comparisons.** Origin: then H05/H06. Exercise history limits, memory growth/correction, reload, repeated playback, asset switching, failure, and cancelled turns with fixtures; compare model candidates only in separately authorized runs. **Done when:** extended sessions remain bounded and coherent, and a model change has comparable quality/latency evidence rather than impressions from one exchange.

## First implementation slice

Start tasks 01–07 and 10, implement task 37's [agreed benchmark](docs/companion-benchmark.md), and move task 25's timing/refresh repair forward. Reuse the existing animation assets, inline tags, string-list memory, and manual Save control. Exercise a quick mutual introduction, emote showcase, flirty teasing and disagreement, and one recorded preference; confirm recall after reload with ordinary dialogue history cleared. Each fixture-driven turn should show thinking, speak with synchronized expression, stop cleanly, and survive unavailable services/assets. Do not redesign memory storage or add detailed mood/familiarity mechanics for this milestone. Then finish context/setup limits and the single-clock speech queue before adding character polish or live microphone models.

Suggested replay targets: stop within 150 ms, no events after cancellation, no overlapping old/new speech, and bounded retained resources across repeated turns. These are proposed acceptance criteria, not measurements. Live first-audio targets must be agreed against the selected machine's budget.
