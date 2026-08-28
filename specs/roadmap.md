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
- [ ] Show latency and FPS/throughput metrics.
- [x] Show command arguments in a reproducible form.
- [x] Show stdout/stderr in a collapsible log view.
- [ ] Distinguish configuration, model-load, inference, and postprocess failures.
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

The two open items are the ones Slice B blocks on. Per-stage latency, FPS and
throughput, and failure attribution to configuration, model load, inference, or
postprocess all require a versioned machine-readable producer contract; Phase 4
must not infer them from human logs.

## Phase 5 — Real E2E matrix

Goal: turn Neuriplo UI into a regression harness rather than only a manual frontend.

- [ ] Start web/server automatically from Playwright configuration or CI.
- [ ] Add deterministic fixture assets.
- [ ] Test at least one pipeline per major task family.
- [ ] Test local backend switching when CI runners support the backend.
- [ ] Test client-server execution against a deterministic test runtime.
- [ ] Assert output artifact creation.
- [ ] Assert structured result semantics rather than only HTTP success.
- [ ] Store Playwright traces and logs on failure.

Suggested first E2E path:

```text
Object Detection
  -> YOLO26
  -> ONNX Runtime or OpenCV DNN
  -> fixture image
  -> successful JSON result
  -> rendered output artifact
```

## Phase 6 — Remote inference and benchmark workflows

- [ ] Expose client-server endpoint/model/version/transport configuration.
- [ ] Show remote server metadata and advertised platform.
- [ ] Compare local and remote inference runs.
- [ ] Add repeated benchmark runs and summary statistics.
- [ ] Add a compact backend/model comparison view.

## Phase 7 — Packaging and CI integration

- [ ] Add linting and formatting gates.
- [ ] Add frontend/unit tests where useful.
- [ ] Add GitHub Actions for build and Playwright smoke tests.
- [ ] Define a Docker/dev-container workflow if it materially simplifies E2E setup.
- [ ] Decide whether release packaging belongs here or in `neuriplo-platform`.

## Guiding rule

Do not solve capability drift inside the frontend. When a new task, model, execution workflow, backend, remote protocol, transport, or parameter is added to Neuriplo, prefer extending the machine-readable contract so the UI discovers it rather than adding another hard-coded list.
