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

- [ ] Define the request schema for `POST /api/runs`.
- [ ] Configure `NEURIPLO_INFER_BIN`.
- [ ] Spawn `neuriplo-infer` using an argument array.
- [ ] Support task, model, execution workflow, and source selection.
- [ ] Require a compatible local backend and weights only for local execution.
- [ ] Require endpoint, remote model metadata, and transport only for client-server execution.
- [ ] Capture exit code, stdout, stderr, and wall-clock duration.
- [ ] Parse `--output_format=json` results.
- [ ] Normalize failures into structured API errors.
- [ ] Expose generated artifacts safely to the browser.

Milestone: run a known object-detection model against a fixture image from the UI.

## Phase 3 — Dynamic pipeline UI

Goal: make the configurator capability-driven.

- [x] Fetch capabilities from the server on startup.
- [x] Make model choices depend on the selected task.
- [x] Let the user choose local or client-server execution when both are available.
- [ ] Make local backend choices depend on model compatibility/availability.
- [x] Show endpoint, remote model/version, and transport controls only for client-server execution.
- [ ] Add file/image/video source selection.
- [x] Add task-specific advanced controls only when relevant.
- [x] Add weights/model-path handling.
- [x] Display validation before launching invalid configurations.

Two items remain open, and both need contract support rather than UI work:

- backend choices currently follow the execution workflow, because the contract
  advertises backends per workflow and not per model; per-model backend
  compatibility has to be advertised before the UI can narrow the list;
- source selection covers source *types* only. Choosing an actual file or
  camera index belongs with the Phase 2 runner, which needs the path anyway.

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

- [ ] Render output images and other visual artifacts.
- [ ] Show structured predictions where available.
- [ ] Show latency and FPS/throughput metrics.
- [ ] Show command arguments in a reproducible form.
- [ ] Show stdout/stderr in a collapsible log view.
- [ ] Distinguish configuration, model-load, inference, and postprocess failures.
- [ ] Allow copying a reproducible CLI command.

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
