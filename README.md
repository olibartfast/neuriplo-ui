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
`$NEURIPLO_INFER_BIN --capabilities` with an argument array and validates the
schema version — 1 or 2 — before returning the response. Version 2 added the
diagnostics section described below; a version 1 binary advertises none, which
the adapter already treats as a build that publishes no run report. This keeps task, model, local backend,
and client-server workflow availability authoritative in the compiled binary.

`POST /api/runs` checks the request against those same capabilities and then
spawns `neuriplo-infer` with an argument array, never a shell string. It returns
the exit code, wall-clock duration, stdout, stderr, the exact command, any
artifacts the run produced, and the parsed JSON result when the run emitted one.
A run that started and failed comes back as `200` with `status: "failed"`;
`4xx`/`5xx` means the adapter could not run anything at all.

A finished run is presented as a terminal report: task, model, execution,
adapter-observed wall time, exit code, signal or timeout state, and run id,
followed by the exact command, the structured result when there is one,
the artifacts, and collapsible stdout and stderr. The command is rendered from
the argument array the adapter actually spawned and quoted for a POSIX shell,
so copying it reproduces the run outside the browser. On a failure stderr opens
by default, because that is where `neuriplo-infer` explains itself.

Two labels are deliberate. The duration in the run header is **wall time for
the whole process** — startup, model load, inference, rendering, and shutdown —
and is never called inference latency. A `null` structured result is an
expected state rather than a parse failure: the binary only prints JSON where
it advertises `--output_format`, and communicates most predictions through the
rendered artifact instead.

Per-stage timings and failure attribution come from the producer, never from
its logs. When `--capabilities` advertises `diagnostics.run_report`, each run
writes a versioned JSON report into its own working directory; the adapter
reads it, validates it, and returns it as `metrics` plus `error.stage`. The UI
then shows a **Producer metrics** section — model load, preprocess, inference,
postprocess, render, sample/frame counts, throughput — separate from the
adapter's own wall time, and labels a failure with the stage it happened in
(`configuration`, `model_load`, `source`, `preprocess`, `inference`,
`postprocess`, `render`).

A measurement the producer did not take is shown as nothing at all: no row, no
zero, no inferred rate. Throughput appears only when the producer supplied both
a processed count and the inference time it belongs to; a report whose schema
version is not the advertised one is dropped rather than half-read; and a build
that publishes no report simply shows no metrics. A timeout or a termination
stays an adapter verdict rather than a producer stage, because the adapter is
what stopped the run.

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
| `NEURIPLO_UI_REMOTE_ALLOW` | Hosts a client-server endpoint may address, as `host` or `host:port`, comma separated. Defaults to loopback only. |
| `HOST`, `PORT` | Adapter bind address. Defaults to `127.0.0.1:5174`. |

Run the build and tests with:

```bash
npm run build
npm test
```

## Runs, comparison, and remote servers

A finished run is retained in the page, newest first, and any of them can be
shown again. History changes which run is displayed and never what a run means,
so the report itself is unchanged. It lives in the browser only: a reload starts
empty, and a retained run whose artifacts the adapter has since cleaned still
shows its command, metrics, and logs.

Ticking two or more runs compares them column by column and marks what differed.
Local against remote needs no special support — they are two runs with different
executions — and backend against backend and model against model fall out of the
same view. The comparison stops at showing the measurements side by side: it
computes no speedup, names no winner, and normalizes nothing across machines.

`Repeat` launches the same configuration N times, one after another so the runs
do not contend for the same device, and summarizes count, minimum, median, and
maximum of everything those runs measured. That is a summary over whole runs,
not over the iterations of a producer benchmark: `--capabilities` advertises
`benchmark` and `iterations`, but the run report publishes a single observation
with nothing per-iteration in it, so a percentile over a producer's own loop
would have to be invented and is not shown. Aggregation is refused across
different tasks, models, or executions, because a minimum over two different
models describes nothing.

For a client-server workflow the adapter asks the endpoint what it is —
KServe V2 `/v2` and `/v2/models/...` — and the UI shows the server, its version
and extensions, and the model's platform, versions, and declared tensors. It is
displayed and never used to narrow a selection: the capabilities contract does
that. A server that cannot be described blocks nothing, because the run remains
the authority on whether the configuration works.

This is the only place the adapter fetches a URL the browser supplied, which
makes it a request-forgery surface: the adapter can reach hosts the browser
cannot. So the endpoint is confined the way source paths are —
`NEURIPLO_UI_REMOTE_ALLOW` names the hosts it may address and defaults to
loopback, an endpoint outside it is refused before anything connects, redirects
are never followed, and the response is read under a byte budget and a timeout.
Host allowlisting does not survive a hostname resolving somewhere unintended:
the guarantee is "only hosts you named", not "whatever DNS says about them".

## End-to-end tests

```bash
npm run test:e2e
```

The suite starts what it tests: Playwright builds both apps, starts the
adapter and a preview of the built frontend, and points `NEURIPLO_INFER_BIN`
at a fixture producer under `e2e/fixtures/producer/`. That fixture implements
the capabilities and run-report contracts and nothing else — it loads no model
and predicts nothing — which is what lets the whole matrix run on a machine
with no models, no weights, and nothing compiled. Inference itself is tested in
`neuriplo-infer`; what is tested here is the path from a contract to a rendered
run.

Every assertion is derived from the advertised contract at runtime, so the same
command runs against a real binary:

```bash
NEURIPLO_INFER_BIN=/path/to/neuriplo-infer npm run test:e2e
```

The two assertions that need a known output — a successful run's artifact,
result and metrics, and a failure attributed to a named stage — check the
advertised `producer.version` first and skip when it is not the fixture's.

The committed assets are placeholders, so a real binary fails on them. That is
still held to something: the run must fail *past configuration*, in the stage
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

The harness binds both servers to `127.0.0.1` and confines sources to the
browse root. Both matter: the page proxies to an adapter that spawns binaries
and turns the files it is given into artifacts the browser can fetch, so an
unconfined adapter reachable from the network is an arbitrary local-file read.

An operator already running `npm run dev` keeps their own servers and producer;
set `CI=1` to force fresh ones. A failing test leaves a trace, a screenshot and
a video under `e2e/test-results/output/`, alongside `adapter.log` and `web.log`
for the two servers.

## Specifications

- [Mission](specs/mission.md)
- [Tech stack](specs/tech-stack.md)
- [Roadmap](specs/roadmap.md)
- [Phase 4 results and diagnostics plan](specs/phase-4-results-diagnostics.md)
- [Phase 5 E2E matrix plan](specs/phase-5-e2e-matrix.md)
- [Phase 6 remote and benchmark plan](specs/phase-6-remote-benchmark.md)

## Status

Roadmap Phases 1 and 2 are implemented: machine-readable capabilities are
produced by `neuriplo-infer` and discovered by the local API adapter, and the
adapter runs real inference from the browser and returns structured results with
their artifacts. Phase 3 is implemented on top of them except for narrowing
local backends per model, which needs the contract to advertise that first.

Phase 4 is complete. Slice A made a terminal run show its structured result,
its reproducible command, its wall time, its artifacts, and both log streams,
with a rejected request visibly distinct from a pipeline that ran and failed.
Slice B added the producer contract it was waiting on: `neuriplo-infer` now
publishes versioned per-stage metrics and a typed failure stage, and this
repository consumes them. Nothing is scraped from log text.

Phase 6 is complete. Runs are retained and comparable, a configuration can be
repeated and summarized, and a client-server endpoint describes itself from
behind an allowlist. Client-server execution is now exercised against a real
`neuriplo-kserve-runtime` — the dependency Phase 5 deferred — with a fixture
KServe responder standing in when no runtime is configured.

Phase 5 is complete. The harness starts the web and server processes itself,
supplies its own producer, and asserts what a run meant: a successful run by
its served artifact, its structured result and its producer metrics, a failed
one by the stage the producer named, its exit code, and its stderr. One task
per structural family runs through the browser, along with each advertised
local backend and the client-server workflow. GitHub Actions runs the same
gates.

Two limits are deliberate. Without a remote runtime, client-server execution
proves the UI and adapter halves and not the server's; and pixel-level
comparison of rendered predictions stays out, because the fixture producer
renders nothing. Both belong to Phase 6.
