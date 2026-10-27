# Build provenance gate

Requirement: browser validation must use the current released infer/tasks/neuriplo
stack, with a verifiable binary and source provenance. Never infer binary contents
from current checkout versions or cache labels. Keep these details out of the UI.

Plan: add a CLI gate and a clean-build recording mode, require it before browser
tests, and document the agent procedure. Existing unknown binaries must fail closed.
No automatic upgrades, branch changes, or sibling repository edits.

Validation defined before implementation: reject stale executable versions, stale
dependency cache pins, missing provenance, changed binaries/sources; accept a clean
recorded build with matching pins. Run regression tests and demonstrate refusal of
both previously used binaries. Latest releases must be queried live, never from
memory; a network failure is a blocked check, not a pass.

Validated 2026-10-26: five regression checks passed (matching provenance,
replaced binary, changed dependency revision, changed cache and cache parsing).
Both old UI binaries were blocked against the current released stack. An
isolated clean release build passed and generated its record, including hashes
of linked shared libraries. Browser multi-model validation uses that exact
binary and runs the gate before opening Chrome.

UI capture freshness: the gate queries remote master and requires it to be an
ancestor of the UI checkout. Feature commits are permitted; stale branches are
blocked. Gate reports include the UI commit, remote master, frontend and adapter
source hashes and lockfile hash, separately from the native build attestation.
