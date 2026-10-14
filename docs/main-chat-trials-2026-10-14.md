# Main-chat trial improvements — 14 October 2026

## Opening gestures and speech

Two independent behaviors explained the reported sequence. The main streaming request awaited optional FBX loading/retargeting. Also, the renderer considered a cue at audio time zero due while waiting for the first audible samples; word metadata could therefore start the opening gesture before speech had even been aligned.

Optional gesture preparation now overlaps the speech request. Loaded clips update available cue bindings without owning audio startup. Gesture cues fire only after samples have played, and remain held during pause/buffering. A clip arriving more than 750 ms after its audio anchor is skipped instead of replaying a stale opening gesture. Slow/unavailable optional clips leave speech usable with idle. This does not remove CPU cost from retargeting or establish a new live latency measurement.

Regressions cover an indefinitely pending gesture loader, pre-audio metadata, paused/starved playback, one-shot cues and late assets. **85 JavaScript tests passed at this step.** No model or new speech generation was run.
