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
npm run dev
```

Run the applications separately when needed:

```bash
npm run dev:web
npm run dev:server
```

## Specifications

- [Mission](specs/mission.md)
- [Tech stack](specs/tech-stack.md)
- [Roadmap](specs/roadmap.md)

## Status

Initial scaffold. The first integration target is a machine-readable contract with `neuriplo-infer`, starting with capabilities discovery and JSON run results.
