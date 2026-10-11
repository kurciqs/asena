# Voice audition — 12 October 2026

Open [the listening room](http://localhost:3001/voice-samples.html) while the existing website is running. This is a separate static page: it loads no avatar, inference runtime or remote application iframe. Audio sources are assigned only after Play; playing another sample pauses the previous one. Hearts save an audition shortlist in this browser, independently of companion settings.

## Recordings prepared

| Generator | Available recordings | Provenance and limits |
|---|---|---|
| Kokoro | Existing af_heart introduction and teasing | Reused the saved benchmark recordings; backend 0.9.0. Kokoro was not started. |
| Pocket TTS | Jane via the September route; Jane and Anna via the earlier English route | Generated the common Asena script on Kyutai’s official hosted service. September endpoint is `english_drifting_26-09/tts`; earlier endpoint is `english/tts`. These are endpoint identities, not verified model hashes. |
| Chatterbox Nano | Common Asena script with the demo’s default reference | Generated on the official Nano Space, with seed 42 and default sampling controls. The supplied public reference is `turbo/2.wav`; the generator itself imports `ChatterboxNanoTTS`. No personal reference recording was uploaded. |
| Qwen3-TTS | Serena 0.6B CustomVoice; a warm companion designed with 1.7B VoiceDesign | Generated on Qwen’s official Space in English. The 0.6B preset is **CustomVoice**, not the quantized MLX **Base** model previously discussed. The designed voice uses the heavier 1.7B model. Neither recording measures Mac performance. |
| Chatterbox Turbo | Published companion-style and female conversational outputs | Direct links to official **generated outputs**, not reference recordings. Different scripts, voices and loudness; these are Turbo examples, not Nano examples. |
| Supertonic 3 | Published Nora introduction and Luna narration | Direct links to official generated custom-voice examples. These are **not bundled F1–F5 presets**. Reproducing these particular voices requires their style embeddings. The runtime project is archived; keep this option secondary. |

The page contains 12 clips. Six newly generated WAVs are saved in `src/voice-audition/`, approximately 2.37 MiB combined. The two Kokoro recordings already existed. Four published showcases stay on their original hosts and require internet when played. Every card links to its source and exposes its transcript and voice notes. `samples.json` records saved-file sizes, durations, sample rates and SHA-256 hashes.

## Common script and generation settings

Pocket, Nano and both Qwen variants read:

> I'm Asena. Nice to meet you, Alex—excellent choice of company. You look suspiciously pleased with yourself. Should I be worried?

The first sentence matches the saved Kokoro introduction. Kokoro's existing teasing clip supplies another short personality example; no new baseline inference was necessary.

Nano: temperature 0.8, seed 42, min-p 0, top-p 0.95, top-k 1000, repetition penalty 1.2, loudness normalization enabled. An additional `[chuckle]` request failed; one shorter retry also failed. The hosted API returned `event: error` with `data: null`, without a diagnostic. The ordinary Nano recording succeeded. Do not treat the failed requests as evidence that Nano cannot produce chuckles; no new tagged recording is included.

Qwen 0.6B: `Qwen/Qwen3-TTS-12Hz-0.6B-CustomVoice`, speaker Serena, English, empty style instruction. Qwen VoiceDesign: `Qwen/Qwen3-TTS-12Hz-1.7B-VoiceDesign`, English, description:

> An adult woman speaking natural conversational English, with a warm, clear, lightly teasing voice. Relaxed rhythm, subtle amusement, like a witty digital companion.

Both used the hosted demo's CUDA/bfloat16 path and generation defaults. Hosted model revisions are not exposed in the result. This is an audition of the published models, not a quantization comparison or a local timing benchmark.

Pocket's streamed WAV responses use placeholder length fields. The saved files have those two header fields corrected to their actual completed byte lengths; PCM samples were not altered, resampled or normalized. This allows normal duration display and seeking in the browser. No recordings have been edited for subjective quality.

## Resource use and removal

No local model installation, model download, dependency installation, Docker startup, Kokoro session or LM Studio session was needed. All new synthesis ran on public demo servers. Only the synthetic script and the Nano demo's existing public reference were submitted. There were no account logins, purchases or uploads of private recordings.

To remove the listening room, remove `src/voice-samples.html` and `src/voice-audition/`; optionally remove this report and its README/TODO links. This removes the entire addition. No virtual environment, hidden model cache, service or package was created. Existing replay recordings should be retained. Browser hearts can be cleared by removing local-storage key `asena.voice-audition.favourites.v1`.

## Verification and next decision

Verified complete PCM data, meaningful WAV duration and manifest hashes for every local clip. All four published audio URLs returned HTTP 200 with an audio MIME type. Browser checks confirm no audio source is assigned before Play, only one clip plays at a time, and the Pause audio control stops it. All clips were opened through the actual listening-page controls. This verifies delivery and playback, not subjective naturalness or local generation speed.

After listening, choose one or two contenders. Then evaluate those on the same longer introduction, teasing, disagreement, pause and vocalization scripts, before selecting a TTS runtime. Local RAM, first-audio latency and lip-sync compatibility remain the separate TODO 11a selection gate. These recordings alone do not justify rewriting the speech pipeline or streaming implementation.

## Sources

- [Existing Kokoro recording run](kokoro-recording-run-2026-10-11.md).
- [Kyutai's official Pocket demo](https://kyutai.org/blog/2026-01-13-pocket-tts) and [September drifting update](https://kyutai.org/blog/2026-09-28-pocket-tts-drifting).
- [Official Nano demo](https://huggingface.co/spaces/ResembleAI/chatterbox-nano-demo) and [demo source](https://huggingface.co/spaces/ResembleAI/chatterbox-nano-demo/blob/main/app.py).
- [Official Qwen demo](https://huggingface.co/spaces/Qwen/Qwen3-TTS) and [demo source](https://huggingface.co/spaces/Qwen/Qwen3-TTS/blob/main/app.py).
- [Official Turbo sample page](https://resemble-ai.github.io/chatterbox_turbo_demopage/).
- [Supertonic 3 model card and generated samples](https://huggingface.co/Supertone/supertonic-3), [archived runtime](https://github.com/supertone-oss-archive/supertonic).
