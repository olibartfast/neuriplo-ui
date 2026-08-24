# Neuriplo UI

Web UI and end-to-end test harness for the Neuriplo inference pipeline.

Neuriplo UI is intentionally kept separate from `neuriplo-infer`. The UI configures and launches inference runs through a small local API adapter while `neuriplo-infer` remains the source of truth for inference behavior and capabilities.

## Goals

- Select task, model, execution workflow, and source from a browser UI.
- Run through either a selected local inference backend or a client-server workflow.
- Launch reproducible `neuriplo-infer` runs.
- Display results, timings, logs, and generated artifacts.
- Provide a browser-driven E2E harness for the complete Neuriplo pipeline.

## Repository layout

```text
apps/
  web/       React + TypeScript UI
  server/    Local API adapter for neuriplo-infer
e2e/         Playwright end-to-end tests
specs/       Mission, technical stack, and roadmap
```

## Development

```bash
npm install
export NEURIPLO_INFER_BIN=/path/to/neuriplo-infer
npm run dev
```

Run the applications separately when needed:

```bash
npm run dev:web
npm run dev:server
```

The local adapter exposes `GET /api/capabilities`. It invokes
`$NEURIPLO_INFER_BIN --capabilities` with an argument array and validates schema
version 1 before returning the response. This keeps task, model, local backend,
and client-server workflow availability authoritative in the compiled binary.

Run the build and server contract tests with:

```bash
npm run build
npm run test:server
```

## Specifications

- [Mission](specs/mission.md)
- [Tech stack](specs/tech-stack.md)
- [Roadmap](specs/roadmap.md)

## Status

Roadmap Phase 1 is implemented: machine-readable capabilities are produced by
`neuriplo-infer` and discovered by the local API adapter. Phase 2 will execute
real inference runs and return structured results.
