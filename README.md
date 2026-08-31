# Neuriplo UI

Web UI and end-to-end test harness for the Neuriplo inference pipeline.

The UI configures and launches runs through a small local API adapter.
`neuriplo-infer` stays the source of truth: every control is generated from the
capabilities the binary advertises, and nothing in the frontend knows what a
task, model, or backend is.

![The Neuriplo UI configurator after a completed object-detection run, showing the discovered task, model, backend, and source controls above the run report: producer metrics, the spawned command, and the rendered output image.](docs/ui.png)

## What it does

- Selects task, model, execution workflow, and source in the browser.
- Runs either a local inference backend or a client-server workflow.
- Shows the result, the producer's own timings, the logs, and the artifacts.
- Prints the exact command the adapter spawned, so a run reproduces outside it.
- Drives the same workflow from Playwright as an E2E harness.

## Layout

```text
apps/
  web/       React + TypeScript UI
  server/    Local API adapter for neuriplo-infer
docs/        Screenshots used by this README
e2e/         Playwright end-to-end tests
specs/       Mission, technical stack, and design notes
```

## Quick start

```bash
npm install
export NEURIPLO_INFER_BIN=/path/to/neuriplo-infer
npm run dev            # or: npm run dev:web / npm run dev:server
```

Both servers bind `127.0.0.1`. They proxy `/api` to an adapter that reads this
machine's filesystem and spawns processes on it, so serving them to a network is
opt-in: set `NEURIPLO_UI_HOST=0.0.0.0` when you mean it. `npm run dev` proxies
`/api` to `http://127.0.0.1:5174`; override with `NEURIPLO_UI_API`.

### Gates

```bash
npm run lint       # formatting, lint, and import order, reported not rewritten
npm run format     # the same pass, applied
npm run typecheck  # web, adapter, and the E2E harness
npm test           # unit tests for the web app and the adapter
npm run build      # both applications
npm run test:e2e   # the browser matrix
```

`npm run typecheck` is the only thing that looks at the E2E harness and the
adapter's tests: neither is compiled by a build, and Playwright and `tsx` both
strip types without checking them.

### Dev container

`.devcontainer/` is optional and exists to ship the browsers and system
libraries the E2E suite needs, so setup is `npm ci` with no
`playwright install --with-deps` and no root on the host. It does not help with
`neuriplo-infer`, its weights, or `neuriplo-kserve-runtime`, which are built
elsewhere and still have to be pointed at.

## How it works

The adapter exposes `GET /api/capabilities`, `POST /api/runs`,
`GET /api/runs/:runId/artifacts/*`, and `GET /api/files`.

**Capabilities.** `$NEURIPLO_INFER_BIN --capabilities` is invoked with an
argument array and its schema version — 1 or 2 — validated before the response
is returned. The frontend renders every choice from it: tasks, models, execution
workflows, local backends, protocols, transports, source types, and the whole
advanced-parameter form, so a new task or backend appears in the UI without a
frontend change. Model IDs and aliases are offered as suggestions and custom
names validated against the advertised wildcard families; parameters are
validated on both sides against the same contract.

**Runs.** `POST /api/runs` checks the request against those same capabilities
and spawns `neuriplo-infer` with an argument array, never a shell string. It
returns the exit code, wall-clock duration, stdout, stderr, the exact command,
the artifacts, and the parsed JSON result when the run emitted one. A run that
started and failed is `200` with `status: "failed"`; `4xx`/`5xx` means the
adapter could not run anything at all.

Each run gets a private working directory, because `neuriplo-infer` writes its
output relative to the current one. That is what makes artifacts safe to serve —
everything inside the directory belongs to that run — and the UI renders inline
whatever the browser can display.

**Diagnostics.** Per-stage timings and failure attribution come from the
producer, never from its logs. When `--capabilities` advertises
`diagnostics.run_report`, each run writes a versioned JSON report the adapter
reads and validates, and the UI shows it as a **Producer metrics** section
separate from the adapter's own wall time, labelling a failure with the stage it
happened in. A measurement the producer did not take is shown as nothing at all:
no row, no zero, no inferred rate. A build that publishes no report simply shows
no metrics.

Two labels are deliberate. The duration in the run header is wall time for the
whole process — startup, model load, inference, rendering, shutdown — and is
never called inference latency. A `null` structured result is expected rather
than a parse failure: the binary only prints JSON where it advertises
`--output_format`.

**File picker.** A browser file input reports a name, never a path, but
`neuriplo-infer` needs a path on the machine the adapter runs on — and weights
are far too large to upload per run. So `GET /api/files` lists the adapter's own
filesystem, and every parameter the contract types as a path gets the picker
alongside the source paths.

![The file picker dialog listing a models directory on the adapter's filesystem, with a selected ONNX weights file and its full path shown before confirming.](docs/file-picker.png)

## Runs, comparison, and remote servers

Finished runs are retained in the page, newest first, and any of them can be
shown again. History lives in the browser only: a reload starts empty, and a
retained run whose artifacts have since been cleaned still shows its command,
metrics, and logs.

Ticking two or more runs compares them column by column and marks what differed
— local against remote, backend against backend, model against model. The
comparison stops at showing measurements side by side: it computes no speedup,
names no winner, and normalizes nothing across machines. `Repeat` launches the
same configuration N times, one after another, and summarizes count, minimum,
median, and maximum over whole runs; aggregation is refused across different
tasks, models, or executions.

For a client-server workflow the adapter asks the endpoint what it is — KServe
V2 `/v2` and `/v2/models/...` — and the UI displays the server, its version and
extensions, and the model's platform, versions, and declared tensors. It never
narrows a selection; the capabilities contract does that.

This is the only place the adapter fetches a URL the browser supplied, which
makes it a request-forgery surface. So the endpoint is confined the way source
paths are: `NEURIPLO_UI_REMOTE_ALLOW` names the hosts it may address and
defaults to loopback, redirects are never followed, and the response is read
under a byte budget and a timeout. The guarantee is "only hosts you named", not
"whatever DNS says about them".

## Adapter configuration

| Variable | Purpose |
| --- | --- |
| `NEURIPLO_INFER_BIN` | Path to the `neuriplo-infer` executable. Required. |
| `NEURIPLO_UI_RUN_ROOT` | Where per-run working directories are created. Defaults to `neuriplo-ui-runs` under the system temp directory. |
| `NEURIPLO_UI_RUN_TIMEOUT_MS` | Kills a run that outlives it. Defaults to 300000. |
| `NEURIPLO_UI_SOURCE_ROOT` | When set, source paths outside this directory are refused. |
| `NEURIPLO_UI_BROWSE_ROOT` | When set, confines the file picker to this directory. Browsing otherwise starts at the adapter user's home directory. |
| `NEURIPLO_UI_REMOTE_ALLOW` | Hosts a client-server endpoint may address, as `host` or `host:port`, comma separated. Defaults to loopback only. |
| `HOST`, `PORT` | Adapter bind address. Defaults to `127.0.0.1:5174`. |

## End-to-end tests

```bash
npm run test:e2e
```

The suite starts what it tests: Playwright builds both apps, starts the adapter
and a preview of the built frontend, and points `NEURIPLO_INFER_BIN` at a
fixture producer under `e2e/fixtures/producer/`. That fixture implements the
capabilities and run-report contracts and nothing else — it loads no model and
predicts nothing — which is what lets the matrix run on a machine with no
models, no weights, and nothing compiled. Inference itself is tested in
`neuriplo-infer`; what is tested here is the path from a contract to a rendered
run.

Every assertion is derived from the advertised contract at runtime, so the same
command runs against a real binary:

```bash
NEURIPLO_INFER_BIN=/path/to/neuriplo-infer npm run test:e2e
```

The two assertions that need a known output check `producer.version` first and
skip when it is not the fixture's. The committed assets are placeholders, so a
real binary fails on them — but it must fail *past configuration*, in the stage
the producer attributes to the inputs it was given, so a binary that rejects
every command line the adapter builds cannot keep the suite green. Point the
suite at inputs a real binary can load and the same tests demand success:

| Variable | Purpose |
| --- | --- |
| `NEURIPLO_UI_E2E_IMAGE` | Image source used for every image-sourced family. |
| `NEURIPLO_UI_E2E_VIDEO` | Video source. |
| `NEURIPLO_UI_E2E_WEIGHTS` | Weights for every parameter the contract types as a path. |
| `NEURIPLO_UI_E2E_ENDPOINT` | Client-server endpoint. Defaults to the remote the harness starts. |
| `NEURIPLO_UI_E2E_RUNTIME` | A built `neuriplo-kserve-runtime`. Started as the remote instead of the fixture responder, so client-server runs reach a real server. |
| `NEURIPLO_UI_E2E_REMOTE_MODEL` | Local model selector for the full client-server round trip. The runtime's stub serves fixed tensor shapes and no contract advertises what a task expects of them, so the operator names a selector that fits. |
| `NEURIPLO_UI_BROWSE_ROOT` | Directory the picker browses and sources are confined to; the assets above must live under it. |

The harness binds both servers to `127.0.0.1` and confines sources to the browse
root, because an unconfined adapter reachable from the network is an arbitrary
local-file read. An operator already running `npm run dev` keeps their own
servers and producer; set `CI=1` to force fresh ones. A failing test leaves a
trace, a screenshot, and a video under `e2e/test-results/output/`, alongside
`adapter.log` and `web.log`.
