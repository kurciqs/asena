# Speech slowdown diagnosis — 14 October 2026

The reported slowdown is real in the speech provider, not just the browser's timer. The first investigation confirmed host memory pressure, but the user reports slow playback after restarting. A subsequent check found **battery power with Low Power Mode enabled**. Memory pressure alone is therefore an incomplete diagnosis. Recovery has **not** been validated in a controlled live trial; this is a diagnosis, not a claim that the incident is fixed.

## Observations

- The Mac has 8 GiB RAM. Swap occupied roughly 6.5 GiB. Crucially, a five-second `vm_stat` sample recorded **10,444 pages swapped out (163.2 MiB)** and **2,393 pages swapped in (37.4 MiB)**. This is current paging activity, not a conclusion drawn merely from old swap occupancy. A later two-second sample showed no swap traffic: pressure fluctuates.
- Kokoro's own logs show individual synthesis times of **17.60 s**, **14.41 s**, and **19.92 s**. The last produced 90,000 samples at 24 kHz: **3.75 s of audio**. That request alone consumed more than five times its output duration. A 2 s startup reserve cannot maintain uninterrupted playback when sustained preparation is slower than consumption.
- Even the same short request varied from **5.77–5.99 s to 3.16 s** during the session. Settings and text length do not account for that variation by themselves. Later requests also ran slowly, so the first cold request is not the entire explanation.
- Only one Docker container was running. It is the existing `v0.9.0` CPU Kokoro container, with its original **2 CPU / 2 GiB** budget and OMP/MKL threads set to 2. No OOM kill was recorded. The Docker VM has roughly 2.85 GiB available RAM in total.
- The container has reached its memory ceiling and reclaimed pages (`memory.events max=388`), but its sampled memory-pressure averages were zero. This is historical limit pressure, not proof of active container thrashing. Its sampled anonymous memory was about 1.21 GiB and file cache 649 MiB. Host swapping is independently confirmed.
- No thermal or CPU performance warning was recorded by macOS. This does not measure every possible power-management limit.
- The running main server's profile remains `stable-122`: 1 s opening region, 2 s later regions, 2 s startup minimum, complete-sentence generation. The browser can still override these through its persisted trial settings.
- The main app resolves the verified **native ARM64 Rhubarb 1.14.0** binary, not the older translated executable. Streaming continues to use one recognizer thread and the shared ownership lock. Only one stream can own that lock.
- A bounded check of L01's first 1.25 s of **saved** audio took **2.17 s** to recognize, with **147.3 MiB peak RSS**. This does not measure live overlapping synthesis, and is not a controlled before/after benchmark. It confirms that the native recognizer still works without a new Kokoro request.

## Interpretation and limits

The accepted S06 baseline reached playback at 9.25 s: approximately 5.81 s until Kokoro's first bytes and 3.17 s of startup Rhubarb work, with no playback gaps. The current provider logs demonstrate a much slower workload. The user also reports both startup components above 5 s.

The accepted profile relies on later generation and alignment keeping up with playback. With slow synthesis, prepared audio drains and the player correctly waits for another aligned region. Cutting the startup reserve makes this worse. Increasing it can conceal some finite stalls but cannot repair throughput.

Memory pressure plausibly affects both the Docker guest's model pages and the native recognizer's model/assets. The observed page traffic, variable synthesis times, unchanged container settings and correct binary make this the leading explanation. They do **not** establish that all slowdown comes from memory: a controlled live retest under a prepared host is still necessary. Rendering, debug redraws and optional first-use gesture loading add competing work; their precise contribution has not been measured in this incident. The recent parallel gesture preparation removes a compulsory wait but can overlap first-use loading with generation.

## Recovery and next validation

1. Keep **1 / 2 / 2, sentences, speed 1.00×** for the comparison. Change neither the provider budget nor the buffer policy during the recovery test.
2. Free host memory by quitting unused applications/tabs. If paging persists, restart the Mac when convenient, then bring up only the required app and Kokoro. The agent did not quit applications, restart Docker, purge memory, or reboot the machine.
3. For immediate uninterrupted UI review, select **Saved recordings** in Debug. These bypass generation and new Rhubarb work. A separate failure there would require a player/rendering diagnosis.
4. On a prepared host, compare the same short benchmark and L01 against their previous results. Capture a first warm-up separately, then warm timings, provider duration/audio duration, Rhubarb segment timings, startup reserve and gaps, with host swap deltas during playback. An isolated region or fixture test cannot certify recovery.
5. If timings remain poor with negligible paging, compare the diagnostic viewer and main chat using identical text/settings; isolate rendering, inspector expansion and first-use gestures one at a time. Do not change provider, alignment algorithm and buffering simultaneously.

Do not raise the container memory limit blindly on an 8 GiB host. LLM integration remains deferred to its coordinated fresh chat, and a combined laptop resource budget must be validated before adding resident inference.

No LLM or new TTS inference was started for this investigation. One bounded saved-audio Rhubarb region was analyzed. Existing accepted settings and runtime services were left intact.

## Follow-up: why a buffer stall became a permanent stop

The user subsequently reported: “Voice stopped after 5.9 seconds” followed by the generic “Kokoro stream unavailable or interrupted” warning. That is the terminal error path, not ordinary starvation: a starved PCM player waits and resumes on the next aligned region.

The HTTP streaming adapter had a hard-coded **15 s no-data read timeout**, shorter than the existing shared service read budget of **30 s**. The latest matching provider sequence took **8.11 s** for its opening request, then **17.03 s** for the next request. The timeout is therefore the leading explanation for termination while the next valid packet was still being generated. The original exception was not retained server-side, so the generic warning alone cannot prove its exact type retroactively.

The transport now uses `NETWORK_TIMEOUT` consistently (default 3 s connection / 30 s read). Reports expose both limits. A socket timeout has a specific message identifying the connection/read limits and distinguishing it from a buffer underrun. Producer cleanup uses the same read budget; socket shutdown still interrupts Stop immediately. The three-minute overall deadline, Rhubarb's separate 15 s region deadline, memory limits and 1 / 2 / 2 settings remain unchanged. This makes slow generation less likely to be discarded; it does not improve generation throughput or guarantee gap-free playback under memory pressure.

Regression checks cover a real stalled local HTTP socket delivering a specific terminal timeout, immediate cancellation of a blocked socket, and playback resuming after a simulated 20 s buffer gap. They use fake providers and saved/mock data, with no new Kokoro generation. Live recovery still needs validation on a prepared machine.

## Follow-up: slow after restart, comparison with the TTS lab

The user confirmed they were on battery, with Low Power Mode enabled and 24% remaining. The current power settings have Low Power Mode disabled on AC. A restart does not change those settings. Power mode should have been checked before recommending a restart; its causal contribution still requires a matched comparison rather than another assumption.

The latest existing provider log showed **4.824 s** for **102,600 samples / 4.275 s of audio** in the companion introduction. This is better than the earlier 14–20 s requests, but the request still took longer than its output duration. The old fast short lab opening and this companion introduction use different words and packet lengths, so their absolute startup times are not a controlled comparison. The user-confirmed S06 sentence-mode baseline remains 9.25 s until playback with zero gaps.

Read-only checks after restart found no Docker CPU throttling or container memory-limit events in the current container lifetime. Host swap occupied about 2.42 GiB; a short idle sample had no new swap-outs. Those snapshots do not measure pressure during synthesis. No extra live generation was run during this follow-up.

Code-path comparison:

- Both interfaces use the same `SpeechStream`, native ARM64 Rhubarb recognizer, sentence splitter, PCM player and startup timing class. The main server has no Rhubarb override. Both servers were checked against the same `stable-122` profile and existing loopback Kokoro endpoint.
- The companion **L01** parser output is byte-for-byte equal to lab **S06 / Tiny opening, longer follow-up**: 502 characters, 89 words, five requests. Default voice/speed/provider payloads match. Use these for the next comparison rather than the two different introduction scripts.
- The companion does more rendering work: animated body, spring physics, expressions and full scene, while the lab fixes the body pose and renders a mouth close-up. Companion trial settings persist; the lab initializes from the default profile. Reset companion speech settings and use `af_heart`, 1.00× for a matched run. Rendering cost is a possible contributor, not yet measured as the cause.
- A separate lab defect was found: its compatibility timing module imported `/speech_startup_timing.js`, but the diagnostic server's asset allowlist omitted that file. This would prevent a fresh lab page from loading. The route is now allowed, with a regression checking the entire transitive local JavaScript module graph. **13 probe tests passed**, and both servers' configuration endpoints and the timing-module HTTP response were checked. This fixes lab availability, not the speech slowdown.

The lab is restored at `http://127.0.0.1:3002/stream-test.html?source=live`; no test starts on opening it. Next acceptance: while connected to power with Low Power Mode off, run S06 in the lab and L01 in the companion separately at 1 / 2 / 2. Hide the other avatar tab during each run. Compare provider time, per-region Rhubarb time and gaps, keeping the first cold run separate. If only the companion remains slower, isolate its rendering/gesture/debug overhead. Do not declare the pipeline fixed merely because low-power operation was discovered.
