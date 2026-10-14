# Main-chat trial improvements — 14 October 2026

## Opening gestures and speech

Two independent behaviors explained the reported sequence. The main streaming request awaited optional FBX loading/retargeting. Also, the renderer considered a cue at audio time zero due while waiting for the first audible samples; word metadata could therefore start the opening gesture before speech had even been aligned.

Optional gesture preparation now overlaps the speech request. Loaded clips update available cue bindings without owning audio startup. Gesture cues fire only after samples have played, and remain held during pause/buffering. A clip arriving more than 750 ms after its audio anchor is skipped instead of replaying a stale opening gesture. Slow/unavailable optional clips leave speech usable with idle. This does not remove CPU cost from retargeting or establish a new live latency measurement.

The complete-recording rollback/replay path also warms optional clips alongside speech preparation and uses only ready actions, so an unresolved gesture no longer blocks that path either.

Regressions cover an indefinitely pending gesture loader, pre-audio metadata, paused/starved playback, one-shot cues and late assets. **85 JavaScript tests passed at this step.** No model or new speech generation was run.

## Expression trials

The avatar's presets already have `isBinary:false`; the binary appearance came from the playback policy. A shared audio-clock envelope now fades expressions in, holds them for a bounded duration and fades back toward neutral, with bounded overlap. Streamed and full-WAV playback use the same envelope. Rhubarb mouth cues remain unchanged. Speaking smile strength is separately reduced to make the existing happy-mouth distortion easier to control; this is provisional tuning, not final face-rig repair.

Debug → **Expression blending** offers Soft / Balanced / Expressive starting points and sliders for intensity, fade-in time, hold, fade-out time and smile while talking. Settings persist locally. Streamed/saved-PCM previews respond during playback; full-WAV tracks pick settings at the next turn. Reports capture initial settings and up to 32 slider edits with their local times. Pause and buffering hold audio-clock expression progression. **87 JavaScript tests passed at this step**, including real-library pause/track checks and smooth bounded envelope checks. Human visual preference still determines the final settings.

### Tuning while viewing the scene

The controls now live in the tools panel's **Expressions** tab, also reachable through Debug → Expression blending → **Tune in scene**. This compact view has no modal backdrop or focus trap, including in narrow windows, so the uncovered canvas still accepts orbit and zoom input. Its title bar supports dragging and arrow-key movement, clamped to the viewport. On phone-sized screens it starts as a short bottom panel, leaving the upper scene visible.

Entering this view temporarily hides chat; **Open chat** remains available for playback controls, and leaving restores the prior visibility. The existing slider bindings, persisted settings and audio-clock behavior are unchanged. **97 JavaScript tests passed**, including five panel tests for modality, chat restoration, movement bounds and keyboard handling. Browser visual review remains unavailable under the earlier browser security restriction. No speech generation or model startup was needed.

## Streaming controls and visible timings

Debug → **Streaming speech settings** now exposes sentence/fragment/short whole-text requests, opening region, later regions, startup reserve and Kokoro speed. The accepted 1 / 2 / 2 sentence configuration is unchanged as the reset baseline; overrides persist separately in the browser and are captured at turn start. Generation controls are disabled for saved audio, and all streaming controls are disabled for old whole-WAV replay. Region packaging/reserve can still be compared on saved PCM without synthesis or Rhubarb work.

The backend rejects whole-text live requests longer than 180 characters before reserving work. This extends the diagnostic viewer's memory guard to the main interface; the previous long whole-request trial exceeded the prepared container limit. Long text should use the bounded sentence mode.

**Speech timing** is visible outside the JSON tree. It advances while waiting and freezes the first-playback total, exposing browser setup, server setup, Kokoro connection/headers/generation/first packet, Rhubarb, reserve wait and browser delivery. The same report remains downloadable. Saved mode labels the bypass and shows playback setup rather than invented synthesis/alignment times. Pure inference and service boot remain unmeasured; overlapping later synthesis/alignment are not added to startup. Checks cover valid/default overrides, immutable baseline and forwarded generation speed. **88 JavaScript tests passed at this step.**

## Longer named demo passages

The main scene selector now includes **Longer conversation trials**: **L01 · Story and expression transitions** (28.41 seconds of existing voice) and **L02 · Numbers and abbreviations** (25.64 seconds). Each can also be selected individually. L01 adds a wave and several anchored emotion/gesture changes across a longer response. L02 stresses normalization and longer speech. The original five-turn introduction/memory benchmark remains five turns.

These reuse the previously captured P05/P06 voice and accepted Rhubarb cues, copied into the replay fixtures so future comparison cleanup will not break the demo. No TTS or fresh alignment was needed. Saved mode uses those files; live Kokoro mode feeds the same longer text through the current generation settings and native analysis only when the user presses Play scene.

Number/abbreviation captions can say “Doctor” for displayed “Dr.” or spell out digits. Those optional captions cannot safely anchor later character offsets. The fallback now retains only explicit **opening** cues at the first audio timestamp and warns about skipped later anchors; it does not guess timing or discard valid speech/Rhubarb lip sync. L01's captions match its text, so its later cue transitions remain timed. Full-WAV replay allows that explicit known-normalization fixture without weakening other failure fixtures.

Human visual/listening acceptance remains open. Before the brief live LLM integration, move to a fresh chat using the existing handoff; afterward return to P2 motion/face/gaze polish, including task 20a's rig-level smile distortion.

Final offline verification: **64 Python and 91 JavaScript tests passed**, and preview preflight has zero blocking issues. The two longer WAVs are byte-for-byte copies of existing recordings. No model load, new speech generation, or fresh Rhubarb analysis was needed for this work. Browser-controlled visual review was unavailable following the browser security restriction; please use the live sliders to choose the appearance, rather than treating automated cue/track tests as visual acceptance.
