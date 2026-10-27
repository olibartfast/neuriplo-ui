# Validation instructions

- Before real inference or browser validation, run `npm run validate:stack` with
  NEURIPLO_INFER_BIN set to the exact adapter executable. The gate must pass.
- Read README's build provenance procedure. Use current released infer, neuriplo
  and neuriplo-tasks revisions; their version numbers are independent.
- Never equate checkout VERSION, CMake cache pins, or a successful old binary run
  with the versions actually compiled. Unknown provenance blocks current-stack
  validation. Never manufacture an attestation for an existing binary.
- If blocked, prepare isolated release checkouts and a fresh configured build;
  record a clean rebuild using the gate. Do not silently switch to an old binary
  or substitute another stack and call the original validation complete.
- The adapter used by the browser must use the same binary hash as the gate.
  Re-run the gate after build, checkout, dependency or executable changes.
- Record the gate report, exact browser command, fixture/weights hashes, run
  response and artifacts. A terminal failure is wiring evidence only. A successful
  run validates the tested model/backend only.
- Contract versioning and provenance checks are agent tooling, not user-facing
  UI choices. Preserve the single human-facing application.

- The UI checkout must include current remote master before browser validation
  or recording. The stack gate checks this and records UI source hashes.
