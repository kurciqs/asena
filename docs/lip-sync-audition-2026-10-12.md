# Kokoro lip-sync audition — 12 October 2026

Kokoro is the user's selected voice generator after listening to the TTS samples. The alternative voice recordings and listening-room files were removed on 12 October 2026 after that decision; their preparation remains recoverable in Git commit `8be81fd`. The next decision is mouth motion, before changing speech delivery to streaming.

Open [the lip-sync studio](http://localhost:3001/lip-sync-samples.html), also linked from Debug & replay. It provides **27 combinations: three original Kokoro af_heart recordings × nine methods**, on the actual Asena avatar. No new speech was synthesized.

## How to compare

Choose the introduction, teasing or disagreement line. Pick two methods, press Play and switch View A / View B during the **same audio playback**. Pause holds the audio cursor and mouth pose; switching methods while paused compares the same instant. Stop clears the face. Repeat is optional. Position and mouth-strength controls apply equally to the methods.

The viewer holds one idle pose, uses one fixed close-up camera and starts with a neutral face. There are no changing body gestures, blink/gaze reactions or different voices to distract from articulation. The smile checkbox is an optional stress test for the existing happy-expression distortion; that deferred production issue is not fixed by this audition.

Use Check the rig to see closure and vowel poses. The inspector reports weights **actually applied to the mesh**, as well as requested controls, audio time and peak mouth movement. One renderer is used; it draws continuously while speech plays and redraws on controls when paused. Hidden tabs pause audio and stop drawing. Models used for analysis are not loaded by the website.

## Prepared methods

| Method | What the sample actually contains | Main limit |
|---|---|---|
| Current renderer reference | The original Rhubarb cue alphabet interpreted by the production mapping, with its triangular per-cue pulses | Contains the known source-alphabet mismatch. It is included as a before comparison. |
| Rhubarb corrected and blended | Original recorded cues, source-specific rig mapping, restrained weights, 40 ms transition kernel and vowel holds | The rig cannot precisely show F/V or a raised tongue. This is a lab adapter, not a production change. |
| Rhubarb short batches | Re-analysis of the identical WAV in one-second retained regions, with up to 250 ms context on each side; one worker; supplied dialogue | Window edges can alter recognition. Processing remains slower than playback on this executable. |
| Dictionary estimates | Existing CMU pronunciation logic, punctuation-normalized words and uniform phone division inside saved word times; separate dictionary alphabet adapter | Phone times are estimated. “Asena” is missing from the dictionary and has no mouth cues. No timing tensors from Kokoro are being claimed. |
| HeadAudio | Unmodified upstream MFCC/Gaussian processor and small trained model, run on original PCM using its offline test hook; frame-centre timestamps and shared rig blending | Demonstrates the classifier, not its browser worklet/main-thread delivery latency. No upstream UI easing is used. |
| Wawa | Upstream frequency heuristic, default 2048-point analyser configuration and 60 Hz updates | Spectra emulate Web Audio offline; browser FFT parity and live timing remain unmeasured. |
| lipsync-engine | Upstream FrequencyAnalyzer, default 256-point configuration and 60 Hz updates; its named extended visemes | Same offline-emulation limit; no reuse of its incompatible simplified A–F alphabet. |
| Amplitude control | Recent audio energy opens one mouth shape | A control for timing only; cannot recognize phonetic articulation. |
| LAM neural | Real inference from the compact community ONNX export, 52 continuous coefficients at 30 Hz; one-second windows, 500 ms hop, overlap weighting, then provisional VRoid retargeting | Fixed input windows, identity 0, no stateful context or proof of live streaming. Several predicted facial movements cannot be represented by this rig. |

All nine methods drive mouth motion in the saved data; the dictionary's named-word gap remains visible. Raw neural coefficients are retained in separate `*-lam-raw.json` files, so retargeting can be revisited without inference. None of these results establishes subjective quality until the user watches them.

## Rig and semantic findings

Asena's VRM1 file exposes five vowel presets: `aa`, `ih`, `ou`, `ee`, `oh`. Its original face morph set also includes a separate `Fcl_MTH_Close` plus other stylized mouth expressions, but no full Oculus or ARKit articulation set. The lab preserves the original morph layout and uses the close morph directly. It reports six aggregate actual morph values across 48 mesh bindings. Production `combineMorphs` behavior is untouched.

The existing consumer interprets A/B/C letters using meanings closer to the dictionary producer. Rhubarb instead defines **A as closed P/B/M**, D as wide-open AA, E as rounded, F as puckered and G as F/V. Opening `aa` for Rhubarb A and closing B is a source-semantic defect, not merely a speed issue. The lab has separate Rhubarb, dictionary, Oculus and ARKit adapters. The original fixture cues are preserved. [Rhubarb's official mouth alphabet](https://github.com/DanielSWolf/rhubarb-lip-sync#mouth-shapes).

The community LAM export's `config.json` gives a different channel ordering from the original LAM model. Applying it directly made jaw opening almost motionless. The original implementation's output list places `jawOpen` at **index 24**, not 17. The sample adapter uses that source ordering, saved with its reference in `lam-channel-order.json`; a regression checks that an eye coefficient cannot open the jaw. Neural distributions also match the original order's paired lower-lip movements. Community-export parity with the original PyTorch checkpoint has not been established. [Original LAM coefficient list](https://github.com/aigc3d/LAM_Audio2Expression/blob/main/models/utils.py), [export metadata](https://huggingface.co/adolon-ai/lam-a2e/blob/main/config.json).

The neural rig adapter combines jaw and lip-lowering controls for opening, pucker/funnel for rounding, stretch for the flatter vowels and mouthClose for closure. It is an explicitly **provisional** mapping onto five stylized vowels and a close morph, not a native 52-shape implementation. Eye/brow outputs are excluded. Closure reduces the available opening weight, and all controls are bounded.

## Measured preparation costs

- **Rhubarb:** installed 1.14.0 x86_64 executable, `pocketSphinx`, supplied window dialogue, `--threads 1`. Thirteen bounded windows took approximately **1.5–4.7 seconds each**. Batching did not produce real-time throughput. Native ARM builds remain a separate optimization experiment; this audition does not claim they were built or measured.
- **LAM:** existing Python/NumPy/ONNX Runtime installation; ORT **1.22.1**, CPU provider, one intra-op and one inter-op thread, graph optimization and CPU arena disabled. The guarded process finished successfully in **9.46 seconds**. Peak process RSS recorded by the worker was **562,626,560 bytes ≈ 537 MiB**. The parent observed approximately 535 MiB. It had a 600 MiB RSS guard and 60-second deadline. The initial sandbox prevented process inspection; that worker was killed, then the guarded run succeeded with permission to inspect its own child process. No monitoring failure was ignored.
- **LAM windows:** first inference **1.124 seconds**; later windows about **0.204–0.306 seconds**. Loading the already-downloaded model took about 0.07 seconds with optimizations disabled. These are isolated preparation observations, not a combined LLM/Kokoro/browser test. A full one-second input must still exist before inference; CPU time is not first-audio latency.
- **Lightweight generation:** the Node script prepared each scene's adapters and detectors in approximately 44–69 ms in the recorded run. This excludes preceding NumPy spectral preparation and does not measure browser latency.

No LLM, Kokoro VM, Docker or alternate TTS engine was started. The bounded LAM process exited; there is no new service or resident model. The hosted official LAM demo returned HTTP 403, so it was not used for synthesis or uploads. The local neural test used only the saved synthetic benchmark recordings.

## Options without comparable Asena samples

| Proposed option | Why it is not presented as a working same-clip sample |
|---|---|
| Kokoro-native duration alignment / HeadTTS | Existing fixtures contain word timestamps, not the matching synthesis phone-duration tensors. A separately prepared Kokoro metadata capture is required. Guessing a timing track and naming it native alignment would be misleading. |
| SG Com | Commercial SDK access/licensing is required. No purchase, account setup or vendor contact was made. |
| Runtime MetaHuman Realistic | Unreal integration; a usable standalone Asena solver is not verified. No Unreal installation was attempted. |
| uLipSync | Unity integration or a deliberate port is required; no Unity installation was attempted. |
| NeuroSync | Gated model and unresolved current runtime/access requirements. No licence acceptance or account setup. |
| Audio2Face Swift/MLX | Identity-specific geometry coefficients need actual geometry retargeting. Reinterpreting those values as VRM/ARKit weights would fabricate a result. |
| Azure speech blendshapes | Tied to synthesized Azure voices; cannot directly supply facial controls for these unchanged Kokoro recordings. It remains a separate optional reference. |

These are explicit access or integration limits, not silent substitutions by a weaker solver. Sources and the original broader shortlist remain in [the speech/mouth plan](speech-and-lip-sync-plan-2026-10-11.md).

## Intended implementation after visual selection

Keep Kokoro. Add a mouth-provider boundary returning **timestamped named controls** and the audio interval covered. A dedicated Asena rig adapter handles the provider's alphabet or coefficient ordering. Buffer audio until its matching mouth data exists; both playback and facial motion follow the same audible sample clock. Carry analysis context across chunks, bound queues, and preserve pause/stop/stale-result ownership.

If corrected Rhubarb is visually preferred, optimize its runtime and test overlapping bounded batches before promising streaming. If HeadAudio is acceptable, verify actual worklet latency and compensate it once in the shared audio path. If LAM wins, validate retargeting and sustained CPU/RAM headroom, then test window context, boundary artifacts and startup delay before integration. The lab itself is not the streaming implementation.

## Reproduction, provenance and removal

Scripts:

```sh
python3 scripts/prepare_lip_sync_samples.py --spectra
python3 scripts/prepare_lip_sync_samples.py --batches
node --experimental-transform-types scripts/build_lip_sync_lab.mjs
```

The frequency-input emulation uses a Blackman window, magnitude smoothing, -100/-30 dB scaling and byte quantization. This is documented emulation, not an assertion of bit-for-bit browser equivalence. Wawa's algorithm is unchanged except relative import paths; Node's experimental TypeScript enum transformation is used only during preparation. HeadAudio, Wawa and lipsync-engine vendor folders retain upstream licences and revision manifests. None is loaded by the lab website: it replays resulting JSON data.

The LAM model was downloaded to ignored `.runtime/lip-sync-lab/` at revision `80b0a40592fcccd1455c88dfba9d7791bbeff6c0`. `lam_ios.onnx`: 234,981 bytes, SHA-256 `f73c6b7b103978ce250919432f574e6516b246d36ac27fd1d0f33142ca0ee497`; external weights: 201,008,640 bytes, SHA-256 `85da29caad1bdc755a2aaaffa020e110e9923ab9e91d1f7f0d7f84f89e04ea6c`. Model card/export licence: Apache 2.0. It was not installed globally. Regenerating neural outputs requires explicitly restoring those model files and running `--lam`; no site action invokes that flag.

The model binaries are removed after preparing and verifying the samples; cached raw inference results and small intermediates stay in that ignored folder for reproducibility. The public audition is approximately **0.5 MiB**, reusing existing audio and avatar assets. It contains no model weights. To remove it, remove `src/lip-sync-samples.html`, `src/lip-sync-lab/`, the two preparation scripts, its dedicated test/report, the replay link and README/TODO references; remove `.runtime/lip-sync-lab/` to clear all experiment intermediates. Existing Kokoro/replay files should remain.

## Verification

Four focused regression checks cover source-alphabet distinctions, neural coefficient ordering, closure versus opening, deterministic audio-position sampling, fixture hashes, complete bounded data and meaningful mouth motion across every method and scene. Browser checks additionally inspect actual rig morphs rather than infer visual correctness from valid JSON. Pause/stop, A/B switching, scene changes and rig calibration are checked on the real page. The user's visual preference and a prepared live benchmark remain outstanding.

Sources: [HeadAudio](https://github.com/met4citizen/HeadAudio), [Wawa](https://github.com/wass08/wawa-lipsync), [lipsync-engine](https://github.com/Amoner/lipsync-engine), [LAM export](https://huggingface.co/adolon-ai/lam-a2e), [original LAM](https://github.com/aigc3d/LAM_Audio2Expression).
