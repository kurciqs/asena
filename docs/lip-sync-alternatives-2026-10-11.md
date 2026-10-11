# Faster lip sync for Asena — research, 11 October 2026

## Recommendation

First correct the existing mouth-shape mapping. Then evaluate **Kokoro's own predicted phoneme durations** as the main generated-speech path, with **HeadAudio** as an inexpensive audio-only fallback and Rhubarb retained for recordings and comparison. This is a recommendation from source inspection, not a measured replacement or a visual-quality verdict. No inference, audio analysis, Docker startup, installation or runtime changes were performed for this research.

Our TTS already knows the sounds it is producing. Recovering those sounds afterward through speech recognition adds avoidable work. The strongest opportunity is to return that synthesis information with each audio segment and feed it to TODO 11's shared playback clock.

## What the existing measurements establish

From the [authorized recording run](kokoro-recording-run-2026-10-11.md):

| Saved clip | Speech duration | Kokoro request | Rhubarb analysis |
|---|---:|---:|---:|
| Teasing | 3.743 s | 2.112 s | 4.614 s |
| Disagreement | 4.562 s | 2.197 s | 4.941 s |
| Short recall | 1.849 s | 0.987 s | 2.130 s |

Across the six clips with both timings, Kokoro took **10.126 s**, Rhubarb **22.770 s**, and speech lasted **19.425 s**. Removing that alignment stage would remove approximately **69% of their combined measured TTS-plus-alignment time**, if synthesis performance stayed unchanged. That excludes LLM generation, startup, conversion, transport and browser preparation; it is not a predicted end-to-end speedup.

These were warm sequential requests, Docker CPU synthesis limited to two cores, and single-worker Rhubarb with matching dialogue after Docker stopped. They are not simultaneous live-pipeline measurements. The current live server does not supply the dialogue file or an explicit Rhubarb thread limit, so its behavior differs from that benchmark. Read-only inspection also confirms the installed executable is x86_64 on the recorded Apple M3 machine; the contribution of translation overhead has not been measured.

## Ranked alternatives

| Approach | Extra wait before speech | Quality expectation / limitation | Fit for Asena |
|---|---|---|---|
| Kokoro phoneme durations | No separate recognition pass; small metadata/mapping work | Strong timing information; still needs natural blending and correct rig mapping | First candidate; extend existing TTS service |
| HeadTTS | Generates audio and viseme times together | Ready-made example of synthesis-driven alignment; local voice/pronunciation parity untested | Good reference or optional replacement TTS backend |
| HeadAudio | Analysis during playback; author documents 50–100 ms processing latency | Approximate sound classification; consonants can be mistaken | First audio-only fallback candidate |
| Existing dictionary path, improved | Mapping after word timestamps arrive; no audio recognition | Phone timings are guessed within each word | Cheapest prototype using current saved fixtures |
| Wawa / lipsync-engine | Browser analysis during playback | Lightweight approximate articulation; assess on our actual face | Secondary fallback candidates |
| Audio2Face via community MLX port | Unknown on this M3 | Rich facial coefficients, requiring substantial retargeting | Later realism experiment |

The latency figures above are upstream descriptions or architectural expectations, except the explicitly identified Asena recording measurements. No alternative has been timed or visually rated here.

### 1. Preserve Kokoro's synthesis alignment

The official [Kokoro model source](https://github.com/hexgrad/kokoro/blob/main/kokoro/model.py) computes `pred_dur`, uses it to expand the input tokens into the acoustic timeline, and returns it alongside audio. This is part of synthesis, not a second recognition model. The [pipeline source](https://github.com/hexgrad/kokoro/blob/main/kokoro/pipeline.py) exposes the phoneme sequence and durations, and converts duration frames into token timestamps; the nominal duration unit is 25 ms.

The published [Kokoro-FastAPI v0.9.0 adapter](https://github.com/remsky/Kokoro-FastAPI/blob/v0.9.0/api/src/inference/kokoro_v1.py) consumes these results but exports word timestamps through `AudioChunk`. Our captured responses likewise contain word timestamps, not phone cues. An adapter extension is needed; this is not a flag Asena can enable today. The exact image-revision source URL recorded in our inventory could not be retrieved during this check, so verify the image's bundled code before preparing a patch.

Proposed output: audio, normalized spoken text, words, and segment-local phoneme/viseme intervals. Export them from **the same synthesis pass**. Account for vocabulary filtering, boundary/stress/punctuation tokens and speed. The [audio conversion source](https://github.com/remsky/Kokoro-FastAPI/blob/v0.9.0/api/src/services/audio.py) trims silence and shifts word times: new phone times need that same transformation, plus any inserted pauses and segment offsets. Validate against the delivered waveform duration.

Predicted synthesis durations are better information than equal word subdivision, but are not manually measured acoustic boundaries. Precise timing also does not supply coarticulation automatically. This route should remove the expensive alignment wait without adding another resident neural model; its local overhead and appearance still need evaluation.

### 2. HeadTTS demonstrates this working design

[HeadTTS](https://github.com/met4citizen/HeadTTS) produces Kokoro audio, phoneme timestamps and Oculus visemes in browser WebGPU/WASM or a Node service. It is MIT licensed and currently documents English support. Its author warns about initial loading and memory use; WASM is slower. Moving speech into the browser would still load a speech model and compete with rendering and local chat resources.

Its [worker implementation](https://github.com/met4citizen/HeadTTS/blob/main/modules/worker-tts.mjs) accumulates model-output duration frames and applies offsets to viseme intervals. This is useful implementation evidence, not merely a demo claim. It emits prepared synthesis outputs; sentence delivery should not be confused with phoneme-by-phoneme waveform streaming.

I would use this as a reference before replacing our Docker service. A replacement would require an API adapter, voice and pronunciation comparisons, cancellation checks, and a new resource baseline. We can preserve Asena's VRM renderer rather than adopt TalkingHead's entire avatar stack.

### 3. HeadAudio for sound without usable timings

[HeadAudio](https://github.com/met4citizen/HeadAudio) runs an MFCC/Gaussian classifier in a browser audio worklet, emitting 15 Oculus viseme weights. It has no external runtime dependencies and is MIT licensed. Its documentation describes roughly **50–100 ms** processing latency and an approximately **14 kB prototype model**, not a 14 kB total installation or RAM footprint. The training examples include `af_heart`, our recorded voice. The author explicitly acknowledges imperfect detection, particularly with noise.

It is a useful fallback when synthesis metadata is absent. That voice overlap makes it worth comparing with our recordings, but does not prove accuracy on Asena. If we delay audio to compensate for classification latency, emotions and gestures must follow the audible clock too. It must share our audio owner and stop/pause behavior rather than run a second independent playback loop.

### 4. The dictionary path and simpler browser analysers

Our [dictionary implementation](../src/dictionary_visemes.js) currently divides each known word's duration evenly among its CMU phonemes and skips unknown words. It needs no second inference pass, but a long vowel and a short stop receive equal time. Normalization, pronunciation fallback, weighted durations and smoother transitions could make it a useful inexpensive comparison. They would remain approximations.

[Wawa Lipsync](https://github.com/wass08/wawa-lipsync) connects to an HTML audio element through Web Audio and returns a live viseme for a custom renderer. It is MIT licensed. [lipsync-engine](https://github.com/Amoner/lipsync-engine) documents frequency-band analysis, smoothing, PCM/audio-element inputs and an approximately 15 kB minified package with no dependencies. Its A–F labels differ from Rhubarb's; do not reuse our existing letter mapping. Neither project's documentation establishes superior visual quality on our avatar. Keep these below synthesis-derived timing in the shortlist.

### 5. Rich neural facial animation on Apple Silicon

The official [NVIDIA Audio2Face-3D SDK](https://github.com/NVIDIA/Audio2Face-3D-SDK) targets CUDA/TensorRT on Windows/Linux. However, there is now a separate community **Swift/MLX port**, so “Audio2Face cannot run on a Mac” would be too broad.

[speech-swift's Audio2Face module](https://github.com/soniqo/speech-swift/blob/main/docs/models/audio2face3d.md) outputs identity-specific geometry coefficients: Mark has 301, Claire/James 169. Its documented input window is 8,320 samples at 16 kHz, or **520 ms**, with a 260 ms hop. This is a window size, not a verified first-output latency. The [Mark weight file](https://huggingface.co/aufklarer/Audio2Face-3D-v2.3-Mark-MLX/tree/main) is listed at approximately **73.1 MB**, excluding runtime, caches and activations. It uses the NVIDIA Open Model License; the wrapper's license does not replace the model's.

The documented geometry basis is not VRM vowel presets or a ready-made ARKit mapping. Retargeting and a native service bridge would be substantial work, and richer predictions would largely be discarded through our present four-channel mouth adapter. There is no verified M3 latency/peak-memory result in the sources reviewed here. Interesting later; not the first latency fix.

[uLipSync](https://github.com/hecomi/uLipSync) offers calibrated MFCC analysis, VRM support and real-time/prebaked modes in Unity, but requires a Unity integration or a port for our JavaScript application. Its README also notes WebGL limitations for Burst/Job System acceleration. It is not a direct lightweight replacement for this renderer. Video-generating talking-head models likewise produce a different output from the expression controls our existing VRM needs.

## A current quality defect to fix before comparing engines

Rhubarb's [documented mouth alphabet](https://github.com/DanielSWolf/rhubarb-lip-sync/blob/v1.14.0/README.adoc#mouth-shapes) defines **A as closed P/B/M**, D as wide-open AA, E as rounded, F as puckered and G as F/V. Our active [expression mapping](../src/expression_tracks.js) instead opens `aa` for A, closes B, maps D/E to `ee`, and G to `aa`. The dictionary producer assigns its own incompatible meanings to those same letters. This is a semantic mismatch, separate from the repaired timing/track-binding bugs.

Use an explicit canonical mouth representation or separate named adapters for each source. Do not “fix” the consumer alone: that would change dictionary playback differently. Preserve the original Rhubarb cue data and convert it at the adapter boundary. Add expected-shape checks for P/B/M, AA, EE, OO and F/V, then inspect the actual face on saved audio.

Current tracks pulse from zero to full strength and back for every cue and use only `aa`, `ee`, `oh`, `ou`. Reaching a natural-looking result also needs overlapping transitions, restrained opening, vowel holds, closure for bilabials, and coordination with happy/emotion blends (TODO 20a). Audit the avatar's available presets and custom morphs before promising 15 distinct visible mouth shapes. A more accurate classifier cannot create missing facial geometry.

## Suggested next steps and evaluation

1. **Offline first:** correct source-specific mapping, preserving recorded cues. Compare the existing Rhubarb and dictionary data on the same seven saved WAVs with neutral expressions. Verify recognizable closures and rounding, then assess happy blending separately.
2. Build a selectable HeadAudio experiment using only saved audio, retaining the existing owner/clock. Measure incremental browser work, visible lag, silence behavior, pause/resume and stopped-turn cleanup. No TTS or LLM is needed for this comparison.
3. Prepare the Kokoro metadata adapter and tests using synthetic duration arrays, speed changes, punctuation, token filtering, silence trimming and phrase offsets. Verify the pinned image's code before finalizing the patch.
4. In a separately authorized short Kokoro run, capture phone-duration fixtures once. Compare timing and appearance against the saved Rhubarb reference; use new audio's own timings, not durations borrowed from a different synthesis.
5. Combine the selected mode with TODOs 12/13's bounded sentence delivery. Initially each complete phrase can carry audio and ready mouth cues. True PCM streaming can follow without making Rhubarb a prerequisite for first audio.

For each option record first playable audio, extra lip-sync preparation time, processing/playback ratio, browser/backend memory and CPU, and queue underruns. Rate mouth/audio agreement, closures, rounded vowels, smoothness and neutral/happy appearance at the same framing. A test that only verifies nonzero morph weights cannot establish convincing articulation.

Rhubarb remains a useful reference, not an automatically superior “quality mode.” If retained, supply dialogue and explicitly bound workers. Its phonetic recognizer is documented as less precise, not as a guaranteed speed improvement. Native ARM64 builds and sentence batching are candidates to measure, not quantified fixes. In particular, the recorded single-worker Rhubarb throughput was slower than speech playback, so batching alone cannot guarantee uninterrupted speech.

This research informs TODO 14 and the measurement work in TODO 16. No generation task has been marked complete.
