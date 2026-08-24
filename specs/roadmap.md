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

- [ ] Add `neuriplo-infer --capabilities` or equivalent command.
- [ ] Return supported task/model combinations.
- [ ] Return available local inference backends for the current build.
- [ ] Return supported execution workflows separately from local backend choices.
- [ ] Return available client-server protocols and transports for the current build.
- [ ] Return supported source types and task-specific parameters.
- [ ] Define a versioned JSON schema for capabilities.
- [ ] Add contract tests in `neuriplo-infer`.
- [ ] Replace the temporary `/api/capabilities` data in this repository.

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

- [ ] Fetch capabilities from the server on startup.
- [ ] Make model choices depend on the selected task.
- [ ] Let the user choose local or client-server execution when both are available.
- [ ] Make local backend choices depend on model compatibility/availability.
- [ ] Show endpoint, remote model/version, and transport controls only for client-server execution.
- [ ] Add file/image/video source selection.
- [ ] Add task-specific advanced controls only when relevant.
- [ ] Add weights/model-path handling.
- [ ] Display validation before launching invalid configurations.

Initial advanced controls may include:

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
