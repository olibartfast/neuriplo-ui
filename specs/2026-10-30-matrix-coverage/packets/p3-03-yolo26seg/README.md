# P3-03 — yolo26seg empty-export triage

Status: complete — confirmed export defect, hashes locked.
Date: 2026-10-31.
Repo: `neuriplo-ui` at `546753566b0dd6cf2b40d667c152319977cb25dd`.

## Scope

| Cell | Role | Gate binary sha256 |
|---|---|---|
| `libtensorflow/yolo26seg` | triage | `5ce8f7cea741381bd27a37561ea0b9af8358fb170b7fd06283757e7be3f8bb19` |
| `litert/yolo26seg` | triage | `89a951c052b0aa9f24101a017534aa7bbc6708c789f2f8a01c7ccf9e0dc59e3b` |
| `libtensorflow/yoloseg` | read-only control | `6782a43e9954d1dff4f509cdbef45f74b75630beb333f5cfaf30f1a8ce11a6a9` (control evidence) |
| `litert/yoloseg` | read-only control | not provisioned |

No re-export, conversion, or control rerun was performed.

## Result

Both triage cells exit 0 with positive inference timing and produce the same
empty render:

- `sha256:81ba80573ce27a0eb5526408d7eb388ee15edbb3cc696d8f82ae5ee7dce6a895`
- pixel-identical to `person.jpg` (0 changed pixels, max channel diff 0)
- byte-identical to the 2026-10-31 CLI pre-screen images on both backends

The read-only `libtensorflow/yoloseg` control renders masks
(`sha256:9d3daaf97bb866bfa65f5d104b844e6e918db64cb269811878bccb832b77585b`,
25,545 changed pixels), so the TF backend path is sound. The yolo26seg
SavedModel/TFLite signature is structurally complete (`images`
`[1,640,640,3]` float32; outputs `[1,300,38]` and `[1,160,160,32]`), matching
the logical shapes of the working ONNX source. The converted graph returns an
empty result.

`litert/yoloseg` has no weights entry in `catalog.json`, no `run.json`, and
`matrix.json` reports `EXPORT_BLOCKED` (“Backend-specific export not
provisioned”). No litert control was created because controls are read-only in
this packet. The litert yolo26seg cell consumes
`yolo26seg_float32.tflite`
(`sha256:42fb61a093db0d31987f5ba15f0268443c891404b48531ff74ce217e1e2d41e2`),
the same artifact embedded in the defective SavedModel, so the shared artifact
plus the libtensorflow control establish the conversion defect. The gap is
recorded in `hashes.md`.

## Evidence

- `artifacts/model-matrix/triage-yolo26seg/hashes.md`
- `artifacts/model-matrix/triage-yolo26seg/io-signatures.json`
- `artifacts/model-matrix/triage-yolo26seg/render-diff.json`
- `artifacts/model-matrix/triage-yolo26seg/official-runs.json`
- `artifacts/model-matrix/triage-yolo26seg/model-files.sha256`
- `artifacts/model-matrix/triage-yolo26seg/post-run-sha256.txt`
- `artifacts/model-matrix/triage-yolo26seg/pre-run-sha256.txt`
- `artifacts/model-matrix/triage-yolo26seg/browser-libtensorflow.log`
- `artifacts/model-matrix/triage-yolo26seg/browser-litert.log`
- Official runs: `artifacts/model-matrix/libtensorflow/yolo26seg/run.json`
  (`3fa1ecdb-41a8-4c15-a102-ebbb4d073edd`) and
  `artifacts/model-matrix/litert/yolo26seg/run.json`
  (`3b8b4965-32d9-4fc5-a19d-7455478f6cc7`)
- Decision: `yolo26seg-export-empty` in
  `artifacts/model-matrix/decisions.json`
- Cell reasons: `artifacts/model-matrix/reviews.json` (the source consumed by
  `report.py` for the two cells)

## Run ledger

| # | Action | Invocation | Outcome |
|---|---|---|---|
| 1 | Capture pre-run evidence hashes | `sha256sum` over the two triage cells and the control | `triage-yolo26seg/pre-run-sha256.txt` |
| 2 | Start a matrix UI server on 5182 in each validation container | `start-server-5182.py`, `NEURIPLO_INFER_BIN` = installation binary, 300 s run timeout | HTTP 200 on both; gate binary matched `gate.json` |
| 3 | First libtensorflow invocation | `BACKEND=libtensorflow MODELS=yolo26seg node browser-matrix.mjs` | No new run: `canReuseEvidence` matched the prior `RUNTIME_PASS` row; old run id retained |
| 4 | Fresh libtensorflow cell | same with `FORCE_MODELS=yolo26seg` | exit 0, RUNTIME_PASS, run `3fa1ecdb-…`, empty render `81ba8057…` |
| 5 | Fresh litert cell | `BACKEND=litert MODELS=yolo26seg FORCE_MODELS=yolo26seg node browser-matrix.mjs` | exit 0, RUNTIME_PASS, run `3b8b4965-…`, empty render `81ba8057…` |
| 6 | Container artifact hashes | `docker exec … sha256sum` over `catalog/yolo26seg-savedmodel` and `catalog/yoloseg-savedmodel` | `triage-yolo26seg/model-files.sha256` |
| 7 | I/O signature dump | TensorFlow 2.19.0 inside the libtensorflow container | `triage-yolo26seg/io-signatures.json` |
| 8 | Pixel comparison | `python3 triage-yolo26seg/render-diff.py` | 0 changed pixels for yolo26seg; 25,545 for the control |
| 9 | Decision and cell-reason update | `decisions.json` entry `yolo26seg-export-empty`; `reviews.json` reasons for the two cells | statuses stay `KNOWN_BAD`; controls untouched |
| 10 | Final scoreboard | `python3 artifacts/model-matrix/report.py` | run exactly once after this note; printed counts reported in the packet response |

## Policy notes

- Triages used the exact gated binaries; the browser runner asserted the binary
  hash before and after each run.
- The first libtensorflow invocation is recorded as a legitimate evidence
  reuse, not as a run. The fresh run was forced explicitly.
- The control is read-only. Its known provenance limitation (control evidence
  predates the `5ce8f7ce…` gate) is recorded in `hashes.md`; it was not
  repaired by rerunning the control.
- `matrix.json` and `REPORT.md` are regenerated only by the single final
  `report.py` invocation. `reviews.json` is updated because it is the source
  that `report.py` applies to the cell reasons.
