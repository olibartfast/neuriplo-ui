# Packet P3-05a — rtdetrul decoder decision (five `KNOWN_BAD` cells)

Date: 2026-10-31. Repo: `/home/oli/repos/neuriplo-ui`.
Owner: implementer subagent (DeepSeek V4.1 Flash 1017).
Status: complete — decision written, reasons rewritten, all five cells stay
`KNOWN_BAD`.

## Scope

Cells: `onnx_runtime/rtdetrul`, `openvino/rtdetrul`, `opencv_dnn/rtdetrul`,
`executorch/rtdetrul`, `tensorrt/rtdetrul`.

Goal (narrow by design): decide whether the recorded reason — "export emits
`[1,300,6]` while the released decoder expects per-class probabilities" — still
describes the gated stack, and record what is actually unknown. No artifact
re-export, no decoder edit or build, no container probe, no inference, and no
browser matrix run in this packet; the findings come from the artifacts already
in the workspace and are written up in
`artifacts/model-matrix/triage-knownbad/rtdetrul-shape.md`.

Writable paths used:

- `artifacts/model-matrix/triage-knownbad/rtdetrul-shape.md` (new)
- this packet directory — `packet.md`
- `artifacts/model-matrix/decisions.json` — one new entry
  `rtdetrul-decoder-mismatch`
- `artifacts/model-matrix/reviews.json` — reasons for the five cells only

`matrix.json` was **not** edited: `report.py` regenerates every cell from
`run.json`, then overlays `reviews.json` for cells whose runtime status is
`RUNTIME_PASS`/`PENDING` (lines 24–27), so `reviews.json` is the durable input
and `matrix.json` is derived.

## Result

- The artifact side is settled: `rtdetrul.onnx`
  (`sha256:293d1b78…e00d`, opset 18) declares one input `images`
  `[1,3,640,640]` FLOAT and a **single** output `output0` `[1,300,6]` FLOAT;
  the `.pte` returns `[(1,300,6)]`; the TRT engine exposes `output0` `1,300,6`;
  the TorchScript model's `RTDETRDecoder` returns normalized
  `cx,cy,w,h,score,class_id`.
- The recorded reason is obsolete for the released line. Tasks v0.8.4
  (`cb67972`) contains `bb4164c` and `8d81fd7`, which add the `dims == 6`
  branch in `src/object_detection/rtdetr_postprocessor.cpp:190`; `git tag
  --contains bb4164c` yields v0.8.3 and v0.8.4. "Awaiting release" no longer
  applies.
- Positive evidence on that decoder exists: the 2026-10-28 candidate stack
  (tasks `76bc188a`, branch `feature/rtdetr-single-output-validation`) ran this
  model on ONNX Runtime and OpenVINO as `RUNTIME_PASS` +
  `REFERENCE_PASS` — `[1,300,6]`, 8 predictions, dog and bicycle boxes — on the
  same weights hash. Control: `libtorch/rtdetrul` is `RUNTIME_PASS` on the
  current released gate (infer v0.11.6 / core v0.11.3 / tasks v0.8.4) and its
  renders were inspected.
- What blocks a promotion is provenance, not a proven decoder bug: every
  archived rtdetrul run is from 2026-10-28, and three of the five backend gates
  still resolve tasks v0.8.2. `opencv_dnn` and `tensorrt` have gate files
  rebuilt on v0.8.4 but no re-run of this model on those binaries. The
  remaining unvalidated half of the path is the input-side preprocessor.
- `opencv_dnn/rtdetrul` additionally hits an independent OpenCV DNN importer
  limitation (`parseUnsqueeze`, multidimensional unsqueeze); the graph does
  carry a multi-axis `Unsqueeze` axes `[3,2,4]`. That is filed as an importer
  defect, separate from the decoder, and is attributed rather than logged in
  this checkout.
- Owner of the preprocessor question: `neuriplo-tasks` (input preprocessing),
  with the matrix runner for the gated re-runs; the importer item belongs to
  the OpenCV DNN backend.

## Deliverables

| obligation | artefact |
|---|---|
| shape/decoder write-up with per-cell provenance | `artifacts/model-matrix/triage-knownbad/rtdetrul-shape.md` |
| decision covering the five cells | `decisions.json` → `rtdetrul-decoder-mismatch` |
| current reason text for the five cells | `reviews.json` (five entries rewritten) |
| decision surfaced in the generated report | `report.py` copies `decisions.json` into `matrix.json.decisions` and `REPORT.md` |

## Fast-follow (not done here)

Re-run the five cells through the gated browser matrix on gates whose
`tasks/VERSION` is >= 0.8.4 (`opencv_dnn` and `tensorrt` already are), capture
the OpenCV import log if it fails, and compare the renders against
`candidate-20261028` (`b5fb7274…0758`). If a cell still renders nothing on the
v0.8.4 decoder, the defect is in that backend's preprocessing or runtime
wiring; if it renders, the cell is promotable on that evidence.
