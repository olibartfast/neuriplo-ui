# P3-04 — NERT/OpenVINO setup failures + OpenCV single-input doc

Status: complete — setup cells triaged, decisions recorded, three cells re-probed
on their gated binaries, no status changes.
Date: 2026-10-31.
Repo: `neuriplo-ui`.

## Scope

| group | cells | role |
|---|---|---|
| NERT setup | `nert/rtdetrv4`, `nert/ecpose`, `nert/owlv2`, `nert/groundingdino` | triage |
| OpenVINO setup | `openvino/owlv2`, `openvino/owlvit` | triage (evidence stale, re-probed) |
| OpenCV DNN setup | `opencv_dnn/raft` | triage (evidence stale, re-probed) |
| OpenCV DNN unsupported | `opencv_dnn/rtdetr`, `rtdetrv2`, `rtdetrv4`, `dfine`, `deim`, `deimv2` (2 inputs), `owlv2`, `owlvit` (3 inputs) | documentation only |
| skipped | `nert/owlvit` | TIMEOUT, owned by P3-06 |

Not run: no engine rebuild, no re-export, no Slurm job, no new backend build.

## Result

- **All seven setup artifacts are present and valid ONNX** (opset 16–18) for
  the backend that reads them. No setup cell is blocked by a missing,
  truncated or unsupported-format file.
- **NERT (four cells): harness contract.** The NERT adapter resolves inputs to
  concrete shapes and refuses a symbolic dimension unless the caller passes
  `input_sizes`; `browser-matrix.mjs` passes `input_sizes` only for `libtorch`
  and `opencv_dnn`, so these four cells are rejected at load and never reach
  inference. Owner: `neuriplo-ui` matrix runner (primary) and `neuriplo` NERT
  adapter (could resolve a dynamic batch from `--batch`, as OpenVINO does).
- **OpenVINO (two cells): adapter defect in the container build.** The
  neuriplo v0.11.1 `OVInfer.cpp` shipped in the openvino validation container
  sets the leading dimension of every input to `batch_size`, turning the
  static 3-text-prompt `input_ids [3,16]` into `[1,16]`; the traced graph then
  cannot reshape 16 elements into `[1,3,16]`. neuriplo v0.11.3 preserves a
  static leading dimension. Owner: `neuriplo` (OpenVINO backend); the block is
  the stale openvino image (infer v0.11.2 / neuriplo v0.11.1).
- **OpenCV DNN `raft`: the documented single-input rule.** The current
  `raft.onnx` loads in 719 ms and preprocesses the frame pair, then the
  adapter rejects it with `got 2 inputs`. The older recorded
  `conv2_layer.cpp` layout assertion came from a superseded `raft.onnx`.
- Every failure reproduces deterministically on the current bytes; nothing was
  promoted. Statuses stay `FAILED` for all 15 cells.

## Evidence

- `artifacts/model-matrix/triage-setup/setup-matrix.md` — per-cell artifact
  presence, format support, declared signature, failure stage, freshness
  table, verdict and owning repository.
- `artifacts/model-matrix/triage-setup/summary.json` — machine-readable
  roll-up (artifact sha256, opset, inputs, stage, error, run id, decision).
- `artifacts/model-matrix/triage-setup/matrix-reasons.json` — the intended
  cell reason text (`[decision: …]` suffix) for the 15 cells.
- Fresh runs, 2026-10-31 (one single-cell `browser-matrix.mjs` run each):
  - `openvino/owlv2` → `22897986-45e7-4031-b10f-414b76d4c5f4` on
    `36669a3b…`, weights `7f176ee3…`
  - `openvino/owlvit` → `241785fd-8b23-411b-9c9c-6943585abe0f` on
    `36669a3b…`, weights `47fd6bd6…`
  - `opencv_dnn/raft` → `af8a6571-c474-4161-90bb-68960da08fe4` on
    `49737e78…`, weights `a7cf3a08…`
- Retained runs (evidence already describes the current artifact):
  `nert/rtdetrv4` `2cd00858…`, `nert/ecpose` `414acdbb…`, `nert/owlv2`
  `1fca4875…`, `nert/groundingdino` `8268c5a7…`.
- Decisions: `nert-openvino-setup-contract` (new) and
  `opencv-dnn-two-input-detr` (scope extended to the 3-input OWL graphs and a
  `raft` note) in `artifacts/model-matrix/decisions.json`.

## Provenance notes

- The `nert` gate (`83b59ad6…`) and the `openvino` gate (`36669a3b…`) are the
  2026-10-28 gates and run infer v0.11.2 / neuriplo v0.11.1 / tasks v0.8.2.
  They are `verified` but older than the current released stack
  (`49737e78…`, infer v0.11.6 / neuriplo v0.11.3 / tasks v0.8.4, used by
  `opencv_dnn`). The NERT and OpenVINO verdicts therefore carry a
  pre-0.11.6 provenance limit; the OpenVINO defect is specifically fixed in
  neuriplo 0.11.3 and cannot be observed on the stale image.
- `triage-setup/setup-matrix.md` records which recorded runs predate their
  artifact; the three affected cells were re-probed rather than described
  from stale text.
- Byte identity between the container artifact and the host catalog copy was
  established by `sha256sum` for every file above; the host copies were read
  with `onnx` 1.22.0 because the containers do not ship the `onnx` package.

## Constraints honoured

- Writes: `artifacts/model-matrix/triage-setup/`, this packet directory,
  `artifacts/model-matrix/decisions.json`, and the `reason` field of the 15
  cells in `artifacts/model-matrix/matrix.json`.
- Read-only: `catalog.json`, `profiles.json`, `reviews.json`, `gate.json`,
  the retained `run.json` files, and the backend source checkouts.
- The three re-probed cells necessarily refreshed their own `run.json`,
  screenshots, and a `results.json` row; that is the side effect of the
  permitted single-cell `browser-matrix.mjs` run, and every other row in
  those `results.json` files was carried through unchanged.
- No `neuriplo-*` change, no image rebuild, no `git tag`/`push`.

## Run ledger

| # | action | outcome |
|---|---|---|
| 1 | read `matrix.json`, `decisions.json`, `catalog.json`, `profiles.json`, `reviews.json`, `report.py`, `browser-matrix.mjs`, `evidence-reuse.mjs` | 7 setup cells `FAILED`, 8 `opencv_dnn` cells documented unsupported, `nert/owlvit` TIMEOUT |
| 2 | `docker exec … sha256sum` + `ls -l` of the 14 artifacts (7 setup + 7 of the 8 `opencv_dnn` cells, sharing `owlv2`/`owlvit` bytes) | all present; host copies byte-identical |
| 3 | `onnx` signature/opset dump of the same bytes | opsets 16–18; input counts 2 (DETR family, raft), 3 (OWL family), symbolic dims only where noted |
| 4 | `gate.json` provenance comparison across `nert`, `openvino`, `opencv_dnn` | NERT/OpenVINO gates on infer v0.11.2 / neuriplo v0.11.1; opencv_dnn on v0.11.6 / v0.11.3 |
| 5 | artifact mtime vs run log timestamp per setup cell | 3 cells (`openvino/owlv2`, `openvino/owlvit`, `opencv_dnn/raft`) ran before their artifact was re-exported |
| 6 | source comparison `OVInfer.cpp` v0.11.1 (container) vs v0.11.3 (release checkout) | v0.11.1 overwrites every leading dimension; v0.11.3 preserves static ones |
| 7 | NERT `NertInfer.cpp` container vs v0.11.3 release source | identical symbolic-dimension policy; the defect is on the caller side |
| 8 | `docker exec` + `start-server-5182.py` in the opencv_dnn container | UI up on 5182 |
| 9 | `BACKEND=opencv_dnn MODELS=raft FORCE_MODELS=raft node browser-matrix.mjs` | run `af8a6571…`, FAILED, `got 2 inputs`, 971 ms |
| 10 | `BACKEND=openvino MODELS=owlv2 FORCE_MODELS=owlv2 node browser-matrix.mjs` | run `22897986…`, FAILED, same reshape error, 2.5 s |
| 11 | `BACKEND=openvino MODELS=owlvit FORCE_MODELS=owlvit node browser-matrix.mjs` | run `241785fd…`, FAILED, same reshape error, 2.4 s |
| 12 | write `setup-matrix.md`, `summary.json`, `matrix-reasons.json` | complete |
| 13 | update `decisions.json` (one new entry, one extended) | 9 decisions |
| 14 | `python3 artifacts/model-matrix/report.py`, once, as the final command | counts reported in the packet response; the reason texts are then re-applied to `matrix.json` because `report.py` regenerates that field from `run.json` |

Outcome: all 15 cells remain `FAILED` with a cause and an owning repository.
The two OpenVINO cells and `raft` are blocked by their container builds;
the four NERT cells are blocked by the matrix runner's missing `input_sizes`;
the eight `opencv_dnn` cells are a recorded backend limitation.
