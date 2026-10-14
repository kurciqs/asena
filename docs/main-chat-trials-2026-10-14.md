# Main-chat trial improvements — 14 October 2026

## Opening gestures and speech

Two independent behaviors explained the reported sequence. The main streaming request awaited optional FBX loading/retargeting. Also, the renderer considered a cue at audio time zero due while waiting for the first audible samples; word metadata could therefore start the opening gesture before speech had even been aligned.

Optional gesture preparation now overlaps the speech request. Loaded clips update available cue bindings without owning audio startup. Gesture cues fire only after samples have played, and remain held during pause/buffering. A clip arriving more than 750 ms after its audio anchor is skipped instead of replaying a stale opening gesture. Slow/unavailable optional clips leave speech usable with idle. This does not remove CPU cost from retargeting or establish a new live latency measurement.

Regressions cover an indefinitely pending gesture loader, pre-audio metadata, paused/starved playback, one-shot cues and late assets. **85 JavaScript tests passed at this step.** No model or new speech generation was run.

## Expression trials

The avatar's presets already have `isBinary:false`; the binary appearance came from the playback policy. A shared audio-clock envelope now fades expressions in, holds them for a bounded duration and fades back toward neutral, with bounded overlap. Streamed and full-WAV playback use the same envelope. Rhubarb mouth cues remain unchanged. Speaking smile strength is separately reduced to make the existing happy-mouth distortion easier to control; this is provisional tuning, not final face-rig repair.

Debug → **Expression blending** offers Soft / Balanced / Expressive starting points and sliders for intensity, fade-in time, hold, fade-out time and smile while talking. Settings persist locally. Streamed/saved-PCM previews respond during playback; full-WAV tracks pick settings at the next turn. Reports capture initial settings and up to 32 slider edits with their local times. Pause and buffering hold audio-clock expression progression. **87 JavaScript tests passed at this step**, including real-library pause/track checks and smooth bounded envelope checks. Human visual preference still determines the final settings.
