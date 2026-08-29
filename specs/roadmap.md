# Roadmap

## Phase 0 — Repository foundation

- [x] Keep `neuriplo-ui` as a standalone repository.
- [x] Create npm workspace layout for web, server, and E2E tests.
- [x] Scaffold React + TypeScript frontend.
- [x] Scaffold local Fastify adapter.
- [x] Scaffold Playwright tests.
- [x] Document mission and technical stack.

## Phase 1 — Machine-readable Neuriplo contract

Goal: remove capability knowledge from the UI and make `neuriplo-infer` authoritative.

- [x] Add `neuriplo-infer --capabilities` or equivalent command.
- [x] Return supported task/model combinations.
- [x] Return available local inference backends for the current build.
- [x] Return supported execution workflows separately from local backend choices.
- [x] Return available client-server protocols and transports for the current build.
- [x] Return supported source types and task-specific parameters.
- [x] Define a versioned JSON schema for capabilities.
- [x] Add contract tests in `neuriplo-infer`.
- [x] Replace the temporary `/api/capabilities` data in this repository.

## Phase 2 — Real inference runner

Goal: execute one real pipeline from the browser.

- [x] Define the request schema for `POST /api/runs`.
- [x] Configure `NEURIPLO_INFER_BIN`.
- [x] Spawn `neuriplo-infer` using an argument array.
- [x] Support task, model, execution workflow, and source selection.
- [x] Require a compatible local backend and weights only for local execution.
- [x] Require endpoint, remote model metadata, and transport only for client-server execution.
- [x] Capture exit code, stdout, stderr, and wall-clock duration.
- [x] Parse `--output_format=json` results.
- [x] Normalize failures into structured API errors.
- [x] Expose generated artifacts safely to the browser.

Milestone: run a known object-detection model against a fixture image from the UI.

Every field of a run request is checked against the discovered capabilities
before anything is spawned, so the adapter keeps no second registry. Model
selectors are the deliberate exception: the contract advertises wildcard
families precisely because the set is not enumerable, so a selector only has to
match an advertised id, alias, or pattern and `neuriplo-infer` stays the final
authority.

Two consequences of the current CLI shape are worth recording:

- local backends are compiled into the binary rather than chosen on the command
  line, so a backend is validated against the workflow and echoed back but never
  becomes an argument;
- `--output_format` is advertised only where the binary actually emits a JSON
  document, so `result` is populated whenever stdout parses as JSON and is null
  otherwise. Structured predictions for the other tasks are rendered into the
  output image, not printed, which is what Phase 4 has to work with.

Runs execute in a private working directory (`NEURIPLO_UI_RUN_ROOT`, defaulting
under the system temp directory) because the binary writes `data/output/...`
relative to the current directory. Everything inside that directory is a run
artifact and nothing outside it is reachable, which is what makes serving them
to the browser safe. `NEURIPLO_UI_SOURCE_ROOT` optionally confines source paths
the same way.

A run that started and failed returns `200` with `status: "failed"`, an exit
code, and logs; `4xx`/`5xx` is reserved for the adapter being unable to run
anything at all.

## Phase 3 — Dynamic pipeline UI

Goal: make the configurator capability-driven.

- [x] Fetch capabilities from the server on startup.
- [x] Make model choices depend on the selected task.
- [x] Let the user choose local or client-server execution when both are available.
- [ ] Make local backend choices depend on model compatibility/availability.
- [x] Show endpoint, remote model/version, and transport controls only for client-server execution.
- [x] Add file/image/video source selection.
- [x] Add task-specific advanced controls only when relevant.
- [x] Add weights/model-path handling.
- [x] Display validation before launching invalid configurations.

One item remains open, and it needs contract support rather than UI work:
backend choices currently follow the execution workflow, because the contract
advertises backends per workflow and not per model; per-model backend
compatibility has to be advertised before the UI can narrow the list.

Source selection now covers both the type and the paths, with one input slot per
source the task advertises (`min_items`/`max_items`, `-1` meaning unbounded).
Paths are chosen through a picker that browses the adapter's filesystem, because
a browser file input reports a file name and never a path while the binary needs
a path on the adapter's machine. Every parameter the contract types as `path`
gets that picker, so a newly advertised path parameter is browsable without a
frontend change.

A second contract gap surfaced while wiring the runner: a protocol advertises
its `transports`, and the parameter catalog separately advertises the enum that
becomes the actual CLI flag, with nothing linking the two. The UI pairs them by
matching the parameter's advertised values against the protocol's transports so
the two cannot disagree, but advertising the parameter id on the protocol would
remove the guesswork.

Advanced controls are rendered from the contract's parameter catalog rather than
from a hard-coded list, so the following arrive automatically:

- confidence threshold;
- NMS threshold;
- batch size;
- GPU toggle;
- warmup;
- benchmark iterations;
- text prompts / VLM prompt;
- client-server timeout and retry controls.

## Phase 4 — Results and diagnostics

Goal: make the UI useful for debugging and performance validation.

Implementation contract: [Phase 4 — Results and diagnostics](phase-4-results-diagnostics.md).

- [x] Render output images and other visual artifacts.
- [x] Show structured predictions where available.
- [x] Show latency and FPS/throughput metrics.
- [x] Show command arguments in a reproducible form.
- [x] Show stdout/stderr in a collapsible log view.
- [x] Distinguish configuration, model-load, inference, and postprocess failures.
- [x] Allow copying a reproducible CLI command.

Artifact rendering landed with Phase 2 because the runner already reports each
artifact's media type: anything the browser can display is shown inline, and
everything else stays a link.

Slice A is complete. A terminal run is now a report rather than a summary line:
a header with task, model, execution, wall time, exit code, signal or timeout
state and run id; the exact command with a copy control; the structured result
when the binary emitted one; the artifacts; and collapsible stdout and stderr
with stderr opened on a failure. Adapter rejection stays a separate state that
never claims a process ran.

Three properties are load-bearing rather than cosmetic:

- the command is rendered from the argument array the adapter spawned and
  quoted for a POSIX shell, never rebuilt from the form, so copying it
  reproduces the run;
- `duration_ms` is whole-process wall time and is labelled as such, because
  calling it inference latency would be false;
- a null `result` omits the section instead of reporting a parse failure, since
  the binary only prints JSON where it advertises `--output_format`.

Slice B is complete, and it started where it had to: in `neuriplo-infer`. Every
run now writes a versioned report to the path `--capabilities` advertises under
`diagnostics.run_report`, carrying per-stage timings, sample and frame counts,
throughput, and the stage a failure is attributed to. The adapter reads that
document from the run's own directory, validates it, and passes it through; the
UI shows producer metrics as a section separate from adapter wall time, and
labels a failure with the producer's stage.

Nothing here is inferred, which is the whole point:

- a stage the producer did not measure is `null` and gets no row, so the UI
  never renders a measurement nobody took;
- throughput appears only when the producer supplied both a processed count
  and the inference time it belongs to;
- a report from an unadvertised schema version is dropped rather than
  half-read, and a build that publishes no report simply shows no metrics —
  including a binary still advertising capabilities `schema_version` 1, which
  predates the diagnostics section and which the adapter still accepts;
- `unknown` is treated as the producer declining to attribute the failure, so
  no stage label is shown at all.

Two adapter-owned outcomes stay separate from producer stages: a timeout and a
termination are the adapter's own verdicts about a run it stopped.

## Phase 5 — Real E2E matrix

Goal: turn Neuriplo UI into a regression harness rather than only a manual frontend.

Implementation contract: [Phase 5 — Real E2E matrix](phase-5-e2e-matrix.md).

- [x] Start web/server automatically from Playwright configuration or CI.
- [x] Add deterministic fixture assets.
- [x] Test at least one pipeline per major task family.
- [x] Test local backend switching when CI runners support the backend.
- [x] Test client-server execution against a deterministic test runtime.
- [x] Assert output artifact creation.
- [x] Assert structured result semantics rather than only HTTP success.
- [x] Store Playwright traces and logs on failure.

The blocker was never the tests, it was the producer: a real run needs weights
measured in hundreds of megabytes and a backend compiled into the binary, so on
an arbitrary machine nothing stronger than "it reached a terminal state" is
true. The harness therefore supplies a fixture producer — a contract double
implementing the capabilities and run-report contracts whose output is a
function of its arguments. It renders nothing and infers nothing, because
inference is `neuriplo-infer`'s own suite's job; what is tested here is the path
from a contract to a rendered run.

Two rules keep the double from becoming a private second source of truth: it is
held to the adapter's own capabilities validator, so a contract change that
breaks the real producer breaks the fixture with it; and every assertion is
derived from the contract at runtime, so the suite runs unchanged against a real
binary. The two assertions that need a known output check the advertised
`producer.version` — the fixture's ends in `-fixture` — rather than being
written twice.

A family here is a shape of contract rather than a kind of model: single-source
image, multi-source, video, and prompt-driven are what the UI actually branches
on. The matrix picks a representative per family from the contract at runtime,
so a real binary exercises its own families without the suite naming any of
them.

One item stays open, and it needs a dependency this repository does not own.
Client-server execution is driven end to end through the browser and the
adapter, but against a producer rather than a server: a deterministic remote
runtime is the missing half, and it belongs with the Phase 6 remote work.

Local backend switching is implemented and skips with its reason on a build
advertising a single backend, which is what every current build does.

## Phase 6 — Remote inference and benchmark workflows

Implementation contract: [Phase 6 — Remote inference and benchmark workflows](phase-6-remote-benchmark.md).

- [x] Expose client-server endpoint/model/version/transport configuration.
- [x] Show remote server metadata and advertised platform.
- [x] Compare local and remote inference runs.
- [x] Add repeated benchmark runs and summary statistics.
- [x] Add a compact backend/model comparison view.

Runs are retained in the page so more than one is alive at a time, which is what
comparison, repetition, and the local-versus-remote question all needed first.
Comparison marks what differed and stops there: no speedup, no winner, no
cross-machine normalization, because two runs on different executions differ in
ways those numbers do not explain.

Repetition is the honest half of the benchmark item. The contract advertises
`benchmark` and `iterations`, but the run report publishes a single observation
with nothing per-iteration in it, so a percentile over a producer's own loop
would have to be invented. What the UI does instead is launch N whole runs,
sequentially, and summarize what they measured — stated as a summary over runs
rather than over iterations. Per-iteration statistics remain a producer contract
extension, exactly like Phase 4's Slice B.

Remote metadata is the adapter's only fetch of a browser-supplied URL, so it is
confined by `NEURIPLO_UI_REMOTE_ALLOW`, defaulting to loopback, with redirects
refused and the response bounded. What comes back is displayed and never used to
narrow a selection: the capabilities contract governs what may be selected, and
a remote server is not a second source of it.

The dependency Phase 5 deferred is now met. `NEURIPLO_UI_E2E_RUNTIME` points the
harness at a built `neuriplo-kserve-runtime`, whose stub backend serves KServe
V2 without a model, and a client-server run completes through the browser
against it. Without one, a fixture responder still answers the metadata paths.

What stays opt-in is the full round trip, and for a contract reason: the stub
serves fixed tensor shapes, and nothing advertises what tensors a task expects,
so the suite cannot choose a compatible selector without encoding producer
knowledge. `NEURIPLO_UI_E2E_REMOTE_MODEL` lets the operator name one, and the
run is then required to succeed.

## Phase 7 — Packaging and CI integration

- [ ] Add linting and formatting gates.
- [ ] Add frontend/unit tests where useful.
- [ ] Add GitHub Actions for build and Playwright smoke tests.
- [ ] Define a Docker/dev-container workflow if it materially simplifies E2E setup.
- [ ] Decide whether release packaging belongs here or in `neuriplo-platform`.

## Guiding rule

Do not solve capability drift inside the frontend. When a new task, model, execution workflow, backend, remote protocol, transport, or parameter is added to Neuriplo, prefer extending the machine-readable contract so the UI discovers it rather than adding another hard-coded list.
