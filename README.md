# Neuriplo UI

Web UI and end-to-end test harness for the Neuriplo inference pipeline.

Neuriplo UI is intentionally kept separate from `neuriplo-infer`. The UI configures and launches inference runs through a small local API adapter while `neuriplo-infer` remains the source of truth for inference behavior and capabilities.

![The Neuriplo UI configurator after a completed object-detection run, showing the discovered task, model, backend, and source controls above the rendered output image.](docs/ui.png)

Every control above is generated from the capabilities the binary advertises;
nothing in the frontend knows what a task, model, or backend is.

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
docs/        Screenshots used by this README
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

The local adapter exposes `GET /api/capabilities`, `POST /api/runs`, and
`GET /api/runs/:runId/artifacts/*`. It invokes
`$NEURIPLO_INFER_BIN --capabilities` with an argument array and validates schema
version 1 before returning the response. This keeps task, model, local backend,
and client-server workflow availability authoritative in the compiled binary.

`POST /api/runs` checks the request against those same capabilities and then
spawns `neuriplo-infer` with an argument array, never a shell string. It returns
the exit code, wall-clock duration, stdout, stderr, the exact command, any
artifacts the run produced, and the parsed JSON result when the run emitted one.
A run that started and failed comes back as `200` with `status: "failed"`;
`4xx`/`5xx` means the adapter could not run anything at all.

Each run gets a private working directory, because `neuriplo-infer` writes its
rendered output relative to the current directory. That is what makes artifacts
safe to serve: everything inside the directory belongs to that run and nothing
outside it is reachable. The UI displays whatever the browser can render —
images and video inline, everything else as a link.

`GET /api/files` lists the adapter's own filesystem so the UI can offer a file
picker. A browser file input only reports a file name, never a path, but
`neuriplo-infer` needs a path on the machine the adapter runs on — and weights
are far too large to upload per run. Every parameter the contract types as a
path gets the picker automatically, alongside the source paths.

![The file picker dialog listing a models directory on the adapter's filesystem, with a selected ONNX weights file and its full path shown before confirming.](docs/file-picker.png)

The frontend renders every choice from that response. Tasks, models, execution
workflows, local backends, protocols, transports, source types, and the whole
advanced-parameter form are derived from the contract, so a new task or backend
in `neuriplo-infer` appears in the UI without a frontend change. Model IDs and
aliases are offered as suggestions, while custom model names are validated
against the advertised wildcard families. Source paths and the whole
advanced-parameter form are validated on both sides against the same contract.
`npm run dev` proxies `/api` to the adapter; override the target with
`NEURIPLO_UI_API`.

## Adapter configuration

| Variable | Purpose |
| --- | --- |
| `NEURIPLO_INFER_BIN` | Path to the `neuriplo-infer` executable. Required. |
| `NEURIPLO_UI_RUN_ROOT` | Where per-run working directories are created. Defaults to `neuriplo-ui-runs` under the system temp directory. |
| `NEURIPLO_UI_RUN_TIMEOUT_MS` | Kills a run that outlives it. Defaults to 300000. |
| `NEURIPLO_UI_SOURCE_ROOT` | When set, source paths outside this directory are refused. |
| `NEURIPLO_UI_BROWSE_ROOT` | When set, confines the file picker to this directory. Browsing otherwise starts at the adapter user's home directory. |
| `HOST`, `PORT` | Adapter bind address. Defaults to `127.0.0.1:5174`. |

Run the build and tests with:

```bash
npm run build
npm test
```

## Specifications

- [Mission](specs/mission.md)
- [Tech stack](specs/tech-stack.md)
- [Roadmap](specs/roadmap.md)

## Status

Roadmap Phases 1 and 2 are implemented: machine-readable capabilities are
produced by `neuriplo-infer` and discovered by the local API adapter, and the
adapter runs real inference from the browser and returns structured results with
their artifacts. Phase 3 is implemented on top of them except for narrowing
local backends per model, which needs the contract to advertise that first.

Phase 4 is next: the run response already carries the command, the logs, the
timings, and the parsed result, so what remains is surfacing them.
