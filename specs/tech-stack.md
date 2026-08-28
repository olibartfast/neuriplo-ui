# Tech Stack

## Repository model

Neuriplo UI is a small npm workspace monorepo containing the browser application, the local API adapter, and browser E2E tests.

```text
apps/
  web/
  server/
docs/
e2e/
specs/
```

This repository remains separate from `neuriplo-infer`. Integration happens at runtime through a machine-readable CLI/API contract.

## Frontend

### React + TypeScript

React provides a straightforward component model for the pipeline configurator, result viewer, logs, and future benchmark views. TypeScript is required so capability and run-result contracts can be shared and validated explicitly.

### Vite

Vite is used for local development and production builds. The UI is intended to remain a lightweight single-page application rather than introduce a server-rendering framework at this stage.

## Local API adapter

### Node.js + TypeScript

The server is responsible for operations a browser should not perform directly:

- invoking `neuriplo-infer`;
- managing local file paths and uploads;
- streaming or collecting stdout/stderr;
- discovering capabilities;
- returning structured run state and artifacts.

### Fastify

Fastify is the initial HTTP layer because the adapter only needs a small, explicit API surface and should stay thin.

Endpoints:

```text
GET  /api/health
GET  /api/capabilities
GET  /api/files
POST /api/runs
GET  /api/runs/:runId/artifacts/*
```

The frontend holds no task, model, backend, protocol, or parameter list. It
fetches `/api/capabilities` on startup and clamps the current selection to what
the response advertises, so an incompatible model or source cannot survive a
task change. Parameter controls are generated from the contract's parameter
catalog, keyed on `value_type`.

`/api/capabilities` executes the binary configured by `NEURIPLO_INFER_BIN`
with `--capabilities`, validates the versioned response, and returns it without
maintaining a second task/backend registry in TypeScript. Missing configuration
returns `503`; execution or contract failures return `502`.

`/api/runs` validates a run request against that same response before spawning
anything, so an unadvertised backend, source type, or parameter is refused with
a `400` rather than reaching the command line. Model selectors are passed
through, because the contract advertises wildcard families precisely so that
non-enumerable selectors stay legal and the binary stays authoritative.

Paths are a browser problem: a file input yields a file name, never a path,
while the binary needs a path on the adapter's machine, and model weights are
too large to upload per run. So `/api/files` lists the adapter's own filesystem
and the UI picks from that. Listings resolve symlinks before checking
containment, so a link inside `NEURIPLO_UI_BROWSE_ROOT` cannot step outside it.

## Execution workflows

Execution topology must be represented explicitly:

```text
local
  -> select an available compiled inference backend
  -> provide local model weights

client_server
  -> select an advertised remote protocol/runtime
  -> configure endpoint, remote model, version, and transport
  -> do not require local model weights
```

The current client-server implementation uses KServe V2 over HTTP or gRPC. `neuriplo-infer` keeps preprocessing and postprocessing local and sends inference tensors to the remote runtime. KServe is therefore not modeled as one of the local backend values.

The capabilities contract should advertise which workflows the current build supports. Local backend availability and remote protocol/transport availability belong under their respective workflow branches.

## Inference integration

The preferred integration boundary is the `neuriplo-infer` executable rather than linking C++ directly into the Node process.

Expected contract:

```text
neuriplo-infer --capabilities
neuriplo-infer ... --output_format=json
```

The adapter should launch the executable with an argument array, not through shell-string concatenation. This keeps quoting predictable and reduces command-injection risk.

Runs execute in a private working directory, because the binary writes its
rendered output relative to the current directory. Everything inside that
directory is an artifact of that run and nothing outside it is reachable, which
is what makes `/api/runs/:runId/artifacts/*` safe to expose.

A run response exposes at least:

```json
{
  "status": "success",
  "run_id": "0e2b1c4a-9d51-4f7c-8a3b-6c5d4e3f2a1b",
  "task": "object_detection",
  "model": "yolo26",
  "execution": {
    "workflow": "local",
    "backend": "onnx_runtime",
    "protocol": null,
    "transport": null
  },
  "command": { "bin": "/opt/neuriplo-infer", "args": ["--type=yolo26"] },
  "exit_code": 0,
  "duration_ms": 12.7,
  "artifacts": [],
  "result": null,
  "stdout": "",
  "stderr": "",
  "error": null
}
```

A run that started and failed is reported as `200` with `status: "failed"`, an
exit code, and its logs. `4xx`/`5xx` is reserved for the adapter being unable to
run anything at all, which keeps "the pipeline failed" distinguishable from "the
adapter is misconfigured".

## End-to-end testing

### Playwright

Playwright drives the same UI workflow used manually. Tests should rely on stable `data-testid` attributes for pipeline controls and status surfaces.

The important E2E boundary is:

```text
browser
  -> neuriplo-ui web
  -> neuriplo-ui server
  -> neuriplo-infer
  -> neuriplo / neuriplo-tasks
  -> selected local backend OR remote inference server
  -> result
```

Smoke tests may use mocked or unavailable runner states, but release-level E2E tests should exercise the real executable and a known fixture/model pair.

## Package management

npm workspaces are sufficient for the current repository size. A more complex monorepo tool should only be introduced if build graph or caching needs justify it.

## Configuration

Runtime-specific values should be supplied through environment variables, for example:

```text
NEURIPLO_INFER_BIN=/path/to/neuriplo-infer
NEURIPLO_UI_BASE_URL=http://127.0.0.1:5173
NEURIPLO_UI_RUN_ROOT=/tmp/neuriplo-ui-runs
NEURIPLO_UI_RUN_TIMEOUT_MS=300000
NEURIPLO_UI_BROWSE_ROOT=/home/user/models
NEURIPLO_UI_SOURCE_ROOT=/home/user/datasets
PORT=5174
HOST=127.0.0.1
```

Do not commit machine-specific model paths or credentials.

## Deliberate exclusions for the initial architecture

- No Electron dependency.
- No direct C++ Node addon.
- No WebAssembly inference path.
- No duplicated TypeScript task/backend registry as a long-term source of truth.
- No database until persisted run history becomes a real requirement.
- No Kubernetes dependency for local usage; client-server execution is an optional workflow exposed through Neuriplo.
