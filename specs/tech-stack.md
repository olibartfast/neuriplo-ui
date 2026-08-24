# Tech Stack

## Repository model

Neuriplo UI is a small npm workspace monorepo containing the browser application, the local API adapter, and browser E2E tests.

```text
apps/
  web/
  server/
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

Initial endpoints:

```text
GET  /api/health
GET  /api/capabilities
POST /api/runs
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

A run response should eventually expose at least:

```json
{
  "status": "success",
  "task": "object_detection",
  "model": "yolo26",
  "execution": {
    "workflow": "local",
    "backend": "onnx_runtime"
  },
  "latency_ms": 12.7,
  "artifacts": [],
  "stdout": "",
  "stderr": ""
}
```

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
