# Packet P3-01 — SIGSEGV triage

Date: 2026-10-31. Repo: `/home/oli/repos/neuriplo-ui`.
Owner: implementer subagent (DeepSeek V4.1 Flash 1017).

## Scope

Cells: `opencv_dnn/ecdet`, `opencv_dnn/ecseg`, `opencv_dnn/ecpose`,
`openvino/videomae`, `openvino/vivit`, `openvino/timesformer`.

Goal: reproduce each crash minimally, capture failing stage + signal, decide
backend-fix versus blocker. No code fixes.

Writable paths used: `artifacts/model-matrix/triage-sigsegv/` and this packet
directory. Read-only inputs: `matrix.json`, `decisions.json`, `catalog.json`,
`profiles.json`, `reviews.json`, `run.json` files, `gate.json` files, the source
checkouts under `artifacts/installer/workspace/` (read only).

## Deliverables

| obligation | artefact |
|---|---|
| one row per cell with repro command, failing stage, signal/stack excerpt, log path | `artifacts/model-matrix/triage-sigsegv/sigsegv-notes.md` |
| machine-readable roll-up (per-cell stage, signal, decision, log) | `artifacts/model-matrix/triage-sigsegv/summary.json` |
| raw gdb/control logs | `artifacts/model-matrix/triage-sigsegv/logs/` (16 files, largest 24 KB; the 176 KB maps dump was reduced to `logs/videomae-fault-mapping.txt`) |
| decision covering the six cells | `artifacts/model-matrix/decisions.json`: `opencv-dnn-ec-gelu-importer-crash`, `openvino-video-5d-infer-crash` |
| cell reasons referencing the decision ids | applied to `matrix.json` (statuses untouched); because `report.py` regenerates that field from `run.json`, the intended text is also kept in `triage-sigsegv/matrix-reasons.json` |

## Findings (short)

- `opencv_dnn` EC family: SIGSEGV during model load in
  `cv::dnn::dnn5::GeluSubGraph::match` -> `extractConstant` inside the OpenCV
  DNN ONNX importer. All three files carry the decomposed exact-GELU
  (`Div`/`Erf`/`Add`/`Mul`) subgraph; `yolo11` (no `Erf`) loads and infers on the
  same gated binary. Two-input models as well, so `opencv_dnn` blocks them twice.
- `openvino` video family: SIGSEGV on the first inference inside the OpenVINO
  CPU plugin (`vmovups` AVX-512 load past the end of `[heap]`), after load,
  preprocess and input binding succeeded. The OpenVINO 2026.3.0 Python API
  infers the same model and tensor without error in five buffer/thread variants.
- Both are deterministic on the gated binaries; neither is a fixture or export
  defect in the "wrong numbers" sense, and neither can be promoted by re-running.

## Constraints honoured

- No code change, no image rebuild, no `git tag`/`push`, no `neuriplo-*` edit.
- `browser-matrix.mjs` was **not** run: it rewrites `<backend>/<model>/run.json`
  and the screenshots next to it, which this packet must not touch. The
  reproduction path was the permitted `docker exec ... gdb` minimal repro.
- Only the two writable directories were written.

## Run ledger

Wall clock: 2026-10-31 13:55–14:06 UTC (about 11 minutes), including analysis.
Tool calls: 44 shell invocations (exploration 15, reproduction 14, controls 12,
docs/edit 3) plus 3 file writes; one acceptance run at the end.

| # | step | outcome |
|---|---|---|
| 1–8 | read `matrix.json`, `decisions.json`, `catalog.json`, `profiles.json`, `reviews.json`, `run.json` for the six cells, `report.py`, `browser-matrix.mjs`, spec validation | six cells `FAILED`, `signal: SIGSEGV`, `error.stage: null`; `report.py` rewrites `matrix.json` from `run.json` + `reviews.json` |
| 9–13 | confirm containers, gate hashes, gdb present in both images, fixtures and weights present | hashes match `gate.json` exactly |
| 14–16 | gdb repro `ecdet` (two quoting attempts, then fixed) | SIGSEGV in importer, 41-line log |
| 17 | gdb repro `ecseg`, `ecpose` | same frame 0/1 |
| 18 | `ecdet` minimal-args run (no `--input_sizes`, no labels) | exit 139 — args irrelevant |
| 19 | `yolo11` control on the same binary | exit 0, 516 ms inference |
| 20 | ONNX graph inspection (`onnx` 1.23.2) | EC models have 12–14 `Erf` nodes, yolo11 has none |
| 21–23 | gdb repro `videomae`; breakpoints on `OVInfer::get_infer_results` / `bind_inputs_and_infer` | both reached; SIGSEGV on an OpenVINO worker thread inside `infer()` |
| 24 | read `OVInfer.cpp` (released source) for the bind path | zero-copy `ov::Tensor(..., const_cast<uint8_t*>(...))` over the task buffer |
| 25–32 | OpenVINO Python controls on the same container/model/shape (plain, 11 threads x5, misaligned views, page-aligned mmap, malloc, guard page) | all pass; one ctypes-tensor attempt rejected by the binding (not evidence) |
| 33 | gdb repro `vivit`, `timesformer` | same fault class, different shapes |
| 34–35 | fault address/instruction and `/proc/<pid>/maps` at the signal | `vmovups` AVX-512 load, 3,478,368 bytes past the end of `[heap]` |
| 36–37 | copy and trim logs into the writable directory | 16 logs, maps dump reduced to the fault neighbourhood |
| 38–40 | write `sigsegv-notes.md`, `summary.json`; verify gate hashes again | notes + summary complete |
| 41–44 | append the two decisions, apply the cell reasons, sanity-check statuses | statuses unchanged for all six cells |
| 45 | acceptance `python3 artifacts/model-matrix/report.py`, run exactly once, as the final action | result reported to the orchestrator; no repair applied afterwards |

Outcome: triage complete. Both root causes are backend/runtime defects on the
gated binaries; the six cells remain `FAILED` and are blocked on an OpenCV DNN
fix/upgrade (EC family) and an infer/OpenVINO fix or upgrade (video family).
