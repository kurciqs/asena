# Comparison cleanup and Debug organization — 14 October 2026

Task 11b was explicitly authorized after Kokoro and Rhubarb were selected. The retired lip-sync comparison page, its alternative-method samples and vendored analyzers, three comparison preparation/build scripts and the dedicated comparison test were removed. The ignored `.runtime/lip-sync-lab` intermediates were also removed. This deleted 51 files/cache entries and freed approximately 10.37 MiB. Historical research, strategy measurements and evidence remain in `docs/`; their reports now identify the old studio as retired. Git history retains the removed comparison source if it is needed again.

The current speech lab previously imported the retired lab's CSS and mouth adapter. It now owns its styles under `src/stream-lab/style.css` and imports `src/rhubarb_mouth.js` directly. Its server asset allowlist no longer exposes the retired paths. The native Rhubarb installation, Rhubarb build/reproducibility work, private memories, existing Kokoro recordings, saved word timings, Rhubarb cues and main speech transport were preserved. Sixteen retained audio/tool files matched their pre-cleanup SHA-256 fingerprints.

## Main-page access and retained features

Open **Debug → Live speech lab**. The link opens the existing port-3002 lab in a new tab, selects live mode when enabled by its server and keeps the current loopback hostname. The lab has a **Back to companion** link. Navigation does not generate speech: the user still presses Start for a live trial. The lab retains named passages, configurable analysis regions/reserve/generation strategy, saved-recording playback, buffering diagnostics, startup breakdown, collapsible JSON and downloadable reports.

Debug now groups its existing controls:

| Group | Features retained |
| --- | --- |
| Scenes & voice | Scene selector, next-scene status, saved/live source and restart |
| Expression blending | Actual rig blend readout and access to the movable slider panel |
| Speech controls | Text-request strategy, opening/later analysis regions, startup reserve, speed and baseline reset |
| Speech timing | First-playback total visible in the folded heading, expandable stage breakdown and measurement notes |
| Turn report | Reply/voice/buffer summary and report download without opening JSON |
| Inspect turn JSON | Expandable data tree and Collapse all |
| Test memories | Save and Clear, kept separate from live memory |

Every original control ID is retained exactly once, so existing handlers and persisted settings continue to apply. Live conversation mode hides the scene/test-memory groups as before. The narrow-window keyboard focus trap includes the new lab link; the Expressions view remains movable and allows scene input. Existing lavender glass styling, transparency and hidden-scrollbar behavior are preserved.

## Verification

- 100 JavaScript tests passed. The retired alternate-method test file was removed; its core Rhubarb mapping/closure checks were retained in a dedicated canonical-mouth test. Shared playback, parsing, expression, cancellation and UI tests remain.
- All 68 Python tests passed. Two mock socket tests initially could not bind a temporary loopback listener under the filesystem sandbox; they passed when rerun with local socket access. These tests used fake providers and did not contact Kokoro.
- All 13 speech-lab server tests passed, including the complete local import graph, styles and explicit 404s for retired lab assets.
- Read-only checks against the running servers verified main navigation, the retired page's 404, lab styles and all 11 local lab modules. No synthesis or recognition trial was started.
- Preview preflight found zero blocking issues. It still reports the existing installed Python-package differences from the pinned requirements; dependencies were not changed for this cleanup.

Browser visual verification remains pending under the earlier browser security restriction. Refresh the main page and lab to load the new organization and independent assets.
