# Streaming fixes, intonation diagnosis and next speedups — 13 October 2026

## Result and where to listen

The two timestamp failures are fixed and both original passages completed real Kokoro → regional Rhubarb trials. Saved recordings now play their stored audio and stored mouth cues directly. JSON inspectors share expandable nested objects/arrays and long strings; live updates preserve open branches and focus.

Open [the test viewer](http://localhost:3002/stream-test.html), select **Saved recordings**, then a named recording. This does not call Kokoro or Rhubarb, simulate packet arrival, or impose a startup reserve. Normal local file loading still takes time. Seven original benchmark recordings are named R01–R07; eight live text cases are S01–S08.

| Recording | Purpose | Audio length |
|---|---|---:|
| **P01 — Cut at “you”** | Exact first request of the previous fast-fragment strategy; listen to the first “you.” | 2.79 s |
| **P02 — Complete opening sentence** | Same original opening, with the sentence completed through “a better story.” | 9.53 s |
| **P04 — Short complete sentences** | Related wording written for speech; complete short requests. This changes the wording, so it is a delivery example rather than an identical-text A/B test. | 9.25 s |
| **P05 — Original mixed passage** | Full S06, using the new sentence/long-clause strategy and the actual streaming region cues. | 28.41 s |
| **P06 — Numbers and abbreviations** | Full S07, deliberately using the previous fragment strategy to reproduce its timestamp problem and verify recovery. | 25.64 s |

P03 was the attempted whole original passage in one provider request. It failed when Docker killed Kokoro for exceeding its existing 2 GiB memory limit; it has no playable recording. Its identifier is reserved so references remain unambiguous. Audio and stored cues are committed under `src/stream-recordings/`; preparation details and full pipeline reports are in its `index.json`. No alternative lip-sync methods have been pruned.

## 1. Why the timestamp errors happened

The old adapter treated captions more than 100 ms beyond received audio as a fatal contract violation. Kokoro sometimes returns punctuation timing extending past the audio tail after silence trimming. This was valid speech with imperfect optional metadata, not missing audio or a Rhubarb alignment failure.

Captured examples:

| Original request | Actual audio | Caption end | Overrun |
|---|---:|---:|---:|
| `mentioned yesterday, ` | 1.426958 s | 1.547958 s | 121 ms |
| Tail ending `if we're early, ` | 5.042542 s | 5.174708 s | 132 ms |

The numbers run appeared to fail around the spoken “tip” because generation was working on a later request while previously prepared audio played. The offending tail belonged to that later request. Repeating the shorter request around “tip” did not reproduce the large overrun. Changing analysis windows/reserves can change where a queued failure becomes audible, but does not alter Kokoro's captions.

**Fix:** actual PCM sample counts define the timeline. Valid captions are bounded to each packet's actual interval; captions wholly outside that interval are dropped. Invalid optional captions are omitted with a diagnostic warning. Request-local timestamps are shifted to the turn timeline once. Audio samples are never stretched, trimmed, or invented to make captions fit. Rhubarb still derives mouth shapes acoustically. Malformed PCM, broken framing, resource limits and cancellation remain real failures.

The viewer exposes nonfatal caption corrections. Failed/stopped trials retain settings, passage, events, startup timing and partial reports, and remain downloadable.

**Evidence:** an offline matrix of 72 buffer configurations covers the two captured failures. Real P05 completed with four tail corrections; real P06 completed with four, including a **131 ms** overrun on its fifth request. Their emitted audio hashes match the provider PCM hashes exactly. These two live trials consumed prepared regions immediately to exercise the complete protocol; they are not measurements of audible playback buffering or gap counts.

## 2. What is changing intonation

There are three different boundaries:

1. **Text requests to Kokoro:** affect what context each inference sees.
2. **Kokoro's own inference chunks:** the provider may split/pack text internally, then returns each generated audio chunk.
3. **Rhubarb analysis regions:** divide already generated PCM for mouth timing; do not resynthesize or change its pitch/speed.

For S06 the old first text request was exactly:

> Hey. I was thinking about that little adventure you

The 60-character opening limit chose a whitespace boundary immediately after “you.” That inference call never saw “mentioned yesterday…” or the rest of the sentence. Ending a request there can produce final-word stress/intonation in the middle of the intended sentence. This is a concrete explanation for the observed location, although final perceptual acceptance requires listening to P01 versus P02/P05.

The official provider README also warns that smaller synthesis chunks can increase intonation artifacts. [Kokoro-FastAPI streaming notes](https://github.com/remsky/Kokoro-FastAPI#features).

Changing Rhubarb regions leaves the same TTS text requests in place, which explains why the intonation error stayed at the same word. An offline regression takes the real P02 waveform through .5/1/2-second opening regions and 1/2/3-second later regions and verifies the reconstructed PCM is **bit-identical**. The player uses the original sample rate without pitch/rate changes; acoustic discontinuities from actual starvation remain a separate possibility, visible in gap diagnostics.

**Fix/prototype policy:** the viewer now defaults to sentence-based requests. Tiny greetings are grouped with the next sentence. Ordinary sentences retain their context; abbreviations such as Dr., p.m. and Oct. are protected. Requests longer than 180 characters prefer clause punctuation, then use a word boundary as a last resort. That fallback bounds request size on this constrained machine and can still affect prosody. It is disclosed in the UI; it is not a promise of perfect sentence preservation. Exact original text/order is preserved, with no punctuation silently inserted. The previous fragment strategy remains selectable for comparisons.

The main companion's existing whole-request default has not been silently changed to this diagnostic policy. TODO 13 remains open for accepted speech-friendly LLM wording and production policy selection. A short complete first sentence is preferable to cutting a longer sentence after an arbitrary word. This should constrain the generated wording itself, rather than rewriting facts after generation.

### Can Kokoro output continuously?

It already accepts a single streaming HTTP request. That does not mean it synthesizes and releases one audio sample at a time. The inspected installed provider packs text into inference chunks; the Kokoro pipeline returns an audio result after the inference for a chunk. Audio can stream between generated chunks, but the first chunk must be generated before its audio arrives. [Kokoro pipeline source](https://github.com/hexgrad/kokoro/blob/main/kokoro/pipeline.py).

The installed provider configuration has target minimum/maximum sizes of **175/250 phoneme tokens**, with an absolute maximum of **450**. Its logs showed S06 packed into **one 344-token inference chunk**. During that attempt the container exited 137 with `OOMKilled=true`, before returning an audio packet. [Resource failure evidence](evidence/kokoro-resource-failure-2026-10-13.json). The 2 GiB budget was not raised. After one restart, smaller serial requests completed; Kokoro was stopped at the end to release model memory.

The test server now rejects whole-passage requests longer than 180 characters before contacting Kokoro. This is a conservative diagnostic safeguard informed by the failure, not a measured universal safe token limit. Smaller text requests also cannot guarantee a peak-memory bound; the container limit still enforces that bound.

## 3. Startup timing and the first slow run

The original reported ~7-second run did not have a retained component report, so its precise cause cannot be established retrospectively. Page-session trial numbers and elapsed time since navigation are now included in saved reports, so first-after-page-load observations can be compared directly.

A fresh live browser run did capture a slow startup under substantial host memory pressure. It used S01 (14 words), sentence requests, .5-second opening analysis, 2-second later regions and a 1-second reserve. It completed with **zero playback gaps**, and visible mouth movement reached 0.6 applied morph strength.

| Startup component | Time |
|---|---:|
| Browser audio setup | .039 s |
| Server preparation | .030 s |
| Kokoro connection | .005 s |
| Request → response headers | .581 s |
| Kokoro generation → first bytes | **9.400 s** |
| Packet receipt/decoding | .016 s |
| Rhubarb before playback | **3.638 s** |
| Waiting for sufficient aligned input | .007 s |
| Browser delivery/scheduling residual | .158 s |
| **First scheduled audible playback** | **13.875 s** |

[Full browser evidence](evidence/stream-startup-under-memory-pressure-2026-10-13.json). These are browser audio-clock estimates, not microphone measurements. Service/model boot occurred outside the test and is explicitly unmeasured. Pure model inference is not separately exposed by the stream.

At the accompanying host check, swap usage was **9,077.69 MiB**, while the container's sampled usage was **1.573 GiB / 2 GiB**. This strongly limits the usefulness of these figures as clean performance benchmarks; it does not prove swap caused every second of delay. The request reached headers in .58 s, so the dominant observed delay was subsequent generation, not a frozen text display or browser connection.

Direct sample generation also varied: P01 took 8.11 s, P02 11.59 s, and P04's first packet arrived at 3.52 s. These are different texts and resource conditions, not a controlled speed ranking. P05's first packet arrived at 6.82 s and P06's at 2.66 s. Larger complete sentences trade lower fragmentation for a larger initial generation job. No automatic hidden TTS warm-up was added.

## 4. JSON and saved-playback fixes

The new diagnostic pages had flat `JSON.stringify` output even though the main inspector already had a tree viewer. The shared viewer now uses stable native disclosure nodes for objects, arrays and long strings. Updates reconcile existing nodes rather than replacing the tree; closed branches populate only when opened. This preserves expansion/focus and avoids rendering long closed data on every animation frame. Inspection refreshes are throttled to 150 ms independently of avatar drawing.

Saved mode previously ran a paced delivery simulation and spawned a new Rhubarb process for every region. It now selects an existing WAV and its stored cue list, uses the recording's media clock for the mouth, and has only Play/Stop/report controls. Analysis size, simulated delivery patterns, artificial stalls and startup-reserve controls are removed from saved mode. Legacy browser simulation endpoints return a retirement message; the separate offline CLI simulator remains for research. A replay report explicitly says `generation: false`, `rhubarbWorkSeconds: 0`, and `simulatedDelivery: false`.

## 5. Further speedup options, in priority order

1. **Short complete LLM sentences, especially the opening.** Aim for an opening of roughly 6–10 words, then short natural sentences. This reduces the first inference job without putting a sentence-ending request boundary after “you.” Keep the displayed/factual content consistent with spoken wording. This is the next TODO 13 step; no LLM was loaded or prompt policy changed in this task.
2. **Trial a smaller provider-side token budget in an isolated configuration.** The installed defaults pack too much audio before release and the whole S06 attempt exceeded the container budget. Lower token targets could retain one streaming HTTP request while returning smaller inference chunks. Need listening review at clause boundaries, exact transcript/timestamp checks and peak-memory monitoring. Configuration changes must be measured under prepared host conditions; they were not applied to the current container.
3. **Use a 1-second opening region with a 1-second playback reserve as the conservative starting point.** With a .5-second first region and a 1-second reserve, Rhubarb must prepare an additional region before playback, paying a second decoder startup. A smaller first region is not automatically faster. Two repeats of isolated saved-audio probes took .64–.81 s for a .5-second opening and .76–.79 s for a 1-second opening on one captured phrase; on another, .56–.57 s versus .70 s. These exclude Kokoro contention and do not establish combined live latency. [Measurements](evidence/rhubarb-opening-region-probes-2026-10-13.json).
4. **Bounded lazy Rhubarb decoder reuse.** Earlier finite-batch measurements showed cold median 1.318 s versus reused 1.061 s, approximately .26 s saved, with RSS rising from 156 to 239 MiB. Implement one serialized worker with idle expiry, cancellation/deadline termination, bounded dialogue-bias state and long-session resource tests before adoption. It remains a prototype, not an installed resident service. The [Rhubarb implementation](https://github.com/DanielSWolf/rhubarb-lip-sync/blob/v1.14.0/rhubarb/src/recognition/PocketSphinxRecognizer.cpp) initializes recognizers for jobs; reuse needs lifecycle work beyond changing worker count.
5. **Native Kokoro with Apple Silicon acceleration as a separate prepared experiment.** The official project supports native macOS MPS; the current Linux CPU Docker container does not use the Mac GPU. This may reduce synthesis time, but it shares the same small unified-memory budget and needs actual measurements. Keep it removable and compare the same named texts, voice and rate. [Official Kokoro-FastAPI setup](https://github.com/remsky/Kokoro-FastAPI).

Do not switch to the lower-agreement known-text aligner, use more Rhubarb workers, raise Docker RAM, or reduce playback reserve blindly to claim a speedup. The accepted native Rhubarb quality stays in place. Before ranking latency, prepare the Mac and repeat fixed texts under comparable memory/load conditions.

## Verification and limits

- **55 Python tests passed**, including the two captured timestamp regressions over 72 buffer configurations, malformed metadata handling, actual socket cancellation, bounded queues, resource guards, sentence boundaries and real-waveform identity across region sizes.
- **74 JavaScript tests passed**, including the shared JSON tree's expansion/node identity and stored-media-clock playback.
- Both formerly failing passages completed real serial Kokoro/Rhubarb trials and their output PCM hashes matched the original provider timeline.
- A real browser live run completed with zero gaps; the expanded nested startup branch retained focus as values changed. Saved audio playback completed using stored cues and no analysis. Final replay of all 28.41 seconds of P05 was verified with Kokoro stopped and live generation disabled; its media `playing` event arrived .103 s after pressing Play (normal file/browser loading, not a microphone-measured first-sound time).
- Listening acceptance of the intonation and the long-sentence fallback is still the user's decision. The full mixed/numbers protocol trials were not audible buffering benchmarks. No LLM, microphone, replacement voice engine, or persistent Rhubarb worker was started.
