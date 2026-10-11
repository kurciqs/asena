# Stabilization review: TODOs 02–09

Work is on `codex/stabilize-todos-02-09`. The baseline commit preserves the previous customizer, replay recordings, inspector, and backlog. Each completed TODO has its own subsequent commit. No LLM, Kokoro, or Docker workloads are started by this work. Tests use saved media and mocked services.

## TODO 02 — Turn ownership and cancellation

A turn controller invalidates prior turn IDs before aborting requests and releasing resources. Stop cancels fetch/audio loading, current playback, and queued gestures. A delayed response cannot update chat, memory, or playback after replacement. The chat displays requesting/preparing/speaking/stopped/failed states; the replay inspector contains the owning turn ID and state. Gesture timers and mouth actions are explicitly owned and released.

Verification: two controller tests cover delayed old results, replacement, abort, idempotent cleanup, and playback failure; eight replay tests still pass. Browser normal replay completed. Browser Stop verification was interrupted by browser automation timeouts and will be revisited during the final UI review. Jakub's visual confirmation remains pending; implementation completion does not claim that approval.
