# Asena dependency check — 11 October 2026

This was an inventory and research pass. No LM Studio app or daemon, language model, Docker VM, container, or Kokoro service was started. No speech or inference request was sent, and nothing was downloaded, installed, or upgraded. Rhubarb and ffmpeg were invoked only to report their versions. Docker metadata queries failed because its engine was unavailable; they did not start it.

**Later follow-up:** the user subsequently authorized downloading Qwen3.5-2B and Kokoro v0.9.0 through Docker, while keeping both models unloaded. See the [download record and streaming recommendation](/Users/kurciqs/Documents/coding/sayuri/asena/docs/runtime-downloads-and-streaming-2026-10-11.md). The inventory below describes the earlier check.

## Installed state

| Component | Confirmed locally | Implication |
| --- | --- | --- |
| Computer | Apple M3, 8 GiB unified memory | Budget for macOS, browser/avatar, language model, and speech together. |
| LM Studio | 0.4.16, build 2 | Installed, but no matching LM Studio/llmster process was seen during the check. |
| Language-model files | Configured downloads directory `/Users/kurciqs/.lmstudio/models` contains only `.DS_Store` | Your configured model library is empty. This does not establish that no weights exist elsewhere on disk. |
| Stored LM runtimes | Newest installed folders found: llama.cpp 2.25.2; MLX 1.10.1 | Runtime files remain after deleting models. Their presence is not a live compatibility test. |
| Docker Desktop | 4.43.2; Docker CLI 28.3.2 | Engine unavailable. Its networking helper is present, which does not establish that the VM is running. |
| Docker settings | 3,072 MiB memory limit; automatic start disabled | This is a configured VM limit, not measured Kokoro memory consumption. |
| Existing Kokoro image/container | Unknown while the engine is off | Cannot confirm whether the old image/container remains, its tag/digest, or its model/voice files without a later inspection. |
| Rhubarb | 1.14.0 at `/Users/kurciqs/Documents/coding/sayuri/rhubarb/rhubarb`; x86_64 executable | Its version invocation succeeds on this M3. No lip-sync processing was tested. |
| ffmpeg | 7.1.1 at `/opt/homebrew/bin/ffmpeg` | Installed. No audio conversion was tested. |
| Python packages | Selected interpreter `/Users/kurciqs/.venv/bin/python3`: Flask 3.0.3, flask-cors 6.0.1, requests 2.32.3 | The current server dependencies exist in that environment. No dependency lock or requirements manifest was found in the checkout. |

The installed Rhubarb version matches the [latest official release](https://github.com/DanielSWolf/rhubarb-lip-sync/releases). Keep it for now; updating it is not a priority.

The [current LM Studio release is 0.4.26, build 4, dated 8 October 2026](https://lmstudio.ai/changelog/lmstudio/lmstudio-v0.4.26). Its earlier [0.4.18 release fixed a bug where some models could ignore reasoning on/off](https://lmstudio.ai/changelog/lmstudio). Updating LM Studio and its runtime is sensible before a future model comparison, after the computer is prepared. Nothing was updated here. The cached settings contain `autoLoadBundledLLM: true`; review automatic model-loading settings before opening the application. That flag alone does not prove that a model is currently present or will load.

## Kokoro: server updates versus speech-model updates

The latest published Kokoro-FastAPI server release is [v0.9.0](https://github.com/remsky/Kokoro-FastAPI/releases/tag/v0.9.0). The registry confirms a CPU image, `ghcr.io/remsky/kokoro-fastapi-cpu:v0.9.0`, with both amd64 and arm64 builds. If Docker remains the chosen deployment, use a tested release tag and record its digest rather than relying on `latest`. [Published CPU package](https://github.com/remsky/Kokoro-FastAPI/pkgs/container/kokoro-fastapi-cpu).

Relevant changes across recent server releases include fixes for interrupted streams, more accurate sentence splitting and normalization, and a correction for missing word timestamps around dashes. Optional idle model unloading and short-reference voice tuning were also added. These deserve isolated evaluation later; they do not establish better performance or expressive speech on this Mac. [Pinned changelog](https://github.com/remsky/Kokoro-FastAPI/blob/v0.9.0/CHANGELOG.md).

The underlying speech model remains [Kokoro-82M; its model card lists v1.0 weights released on 27 January 2025](https://huggingface.co/hexgrad/Kokoro-82M). Server v0.9.0, the Python package version, and neural-model v1.0 are separate version numbers. I found no evidence of a new official Kokoro v2 speech model, and could not identify your installed weights.

Apple Silicon support needs a correction to the old installation guide: the Docker GPU image targets NVIDIA CUDA. On this M3, use the CPU image inside Docker, or consider upstream's native macOS MPS route outside Docker. Native MPS could remove VM overhead and use the Apple GPU, but speed, memory, and contention with the LLM still need measurement. It was not installed or started. [Upstream deployment instructions](https://github.com/remsky/Kokoro-FastAPI/blob/v0.9.0/README.md).

Asena currently uses `/dev/captioned_speech`. Before changing the speech server, capture and check that endpoint's response contract against a pinned release. A server upgrade alone does not repair Asena's full-response buffering or synchronize its animation and audio.

## Model shortlist

Your [installation notes](/Users/kurciqs/Documents/coding/sayuri/asena/INSTALLATION.md:7) name OpenHermes 2.5 Mistral 7B for debugging and Tiger Gemma 9B v1 for richer, more verbose conversation. On this 8 GiB machine, I would start with a modern smaller model instead of restoring both large models. These are candidates for evaluation, not confirmed improvements in companion quality.

| Candidate | Quantization and published file size | Recommendation |
| --- | --- | --- |
| **Qwen3.5-2B** | GGUF Q4_K_M, **1.28 GB** | First resource baseline when eventually testing LLM plus speech. Leaves more room than the 4B choices, with quality still to assess. [Quantized files](https://huggingface.co/unsloth/Qwen3.5-2B-GGUF/tree/main). |
| **Qwen3.5-4B** | GGUF Q4_K_M, **2.74 GB** | Main general-purpose candidate for following personality settings, concise conversation, and later behavior cues. [Official model](https://huggingface.co/Qwen/Qwen3.5-4B), [quantized files](https://huggingface.co/unsloth/Qwen3.5-4B-GGUF/tree/main). |
| **HauhauCS Qwen3.5-4B Uncensored Aggressive** | GGUF Q4_K_M, **2.71 GB** | Optional community alternative closer to your interest in unrestricted character interaction. Compare against stock Qwen rather than assuming refusal removal improves warmth, creativity, or instruction adherence. The author's quality claims are unverified here. [Model card](https://huggingface.co/HauhauCS/Qwen3.5-4B-Uncensored-HauhauCS-Aggressive), [files](https://huggingface.co/HauhauCS/Qwen3.5-4B-Uncensored-HauhauCS-Aggressive/tree/main). |

These are download sizes, not total runtime RAM. Runtime buffers, context, other applications, and Docker add memory use. None is a guarantee that simultaneous LLM and Kokoro operation will be comfortable.

Qwen3.5 supports thinking and direct-response modes. LM Studio's [Unsloth model entry exposes Enable Thinking and defaults it to true](https://lmstudio.ai/unsloth/qwen3.5-4b). For companion dialogue, test with thinking disabled through the supported model/backend configuration; hiding reasoning text after generation does not remove its latency. Verify that control on the actual runtime later. Start with a short context, approximately 2,048 tokens if the prompt fits, and a bounded reply; skip the vision projector for text-only use. These are proposed initial settings, not changes already applied.

I also checked newer Qwen releases. The official Qwen3.8 releases visible in the [publisher's current model list](https://huggingface.co/Qwen/models) are much larger than this shortlist. Small community distillations should not be mistaken for an official small Qwen3.8 release merely from their names.

For a stronger machine, three candidates are closer to your original choices or the companion goal:

- [TheDrummer Anubis Mini 8B v1](https://huggingface.co/TheDrummer/Anubis-Mini-8B-v1): a current creative model from the same author as Tiger, with a Llama 3 chat template. Worth comparing for dialogue style; not a comfortable default with Docker on this Mac.
- [Nous Hermes 4 14B](https://huggingface.co/NousResearch/Hermes-4-14B): a newer model from the OpenHermes authors, aimed at steerability and creative tasks. Keep it on the stronger-machine shortlist.
- [Tinman Gemma 4 companion](https://huggingface.co/Tinman-Lab/Tinman-gemma4-companion-merged): explicitly tuned for companionship and roleplay. Its author lists a roughly 5 GB Q4_K_M file. Gemma 4 E4B has approximately 8B total parameters despite its effective-parameter name; do not budget it like an ordinary 4B model. [Official Gemma size table](https://huggingface.co/google/gemma-4-E2B-it).

The model's tone needs a bounded comparison using Asena's actual profile prompt: warmth without repetitive flattery, stable personality, concise spoken replies, user-directed closeness, remembered facts without invented history, and valid behavior cues. Newer benchmark results or fewer refusals alone cannot establish a more believable companion.

## Follow-up work, before a future live session

1. **Keep development independent of model availability.** Proceed with task 01's fixtures while heavy services stay off.
2. **Remove the hardcoded old model name.** [The request currently names OpenHermes](/Users/kurciqs/Documents/coding/sayuri/asena/src/main.js:141). Centralize endpoints, model identifier, context/output limits, and executable paths under TODO 09; selecting a new download in LM Studio will not by itself update this request.
3. **Record exact dependency versions.** Pin the selected LM runtime, model publisher/file/revision, Kokoro image digest, and Python environment when a combination has been validated. Correct the Apple GPU guidance in the setup documentation.
4. **After explicit preparation for heavy services, inspect the existing Kokoro installation.** Identify its image, digest, architecture, mounts, weights, and voice files before choosing an upgrade. Do not infer the installed version from the old `latest` instructions.
5. **Test in stages after that preparation.** Establish one small LLM's memory and response behavior first, then speech separately, then their combined workload. Avoid extra resident models for memory extraction or draft generation. Assess peak memory, swap, first-response/first-audio latency, interruptions, and the caption contract before choosing the default.

Only this report was added by this dependency check. Runtime code, installed applications, settings, and the running website were not changed.
