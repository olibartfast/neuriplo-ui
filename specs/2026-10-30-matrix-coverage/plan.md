# Plan — matrix coverage

## Phase 1 — LibTorch metadata migration

Status: done. 19 cells pass; the three video cells are documented CPU
timeouts.

Deliverable: all 22 libtorch cells re-run on the gated binary, with the 17
legacy archives re-saved with input-datatype metadata.

Tasks:

1. Back up the 17 legacy archives and record their hashes.
2. Load each archive, read its forward signature, and re-save it with the
   example shapes from its recorded run command and the known dtypes (FP32
   images; `raft` takes two FP32 images). Anything whose signature cannot be
   matched stops and is marked BLOCKED.
3. Verify each new archive carries `neuriplo_input_dtypes.txt` and loads with
   the release libtorch.
4. Re-run every libtorch cell through the browser matrix on the gated binary.
5. Inspect one rendered output per task family: detection, segmentation,
   classification, pose, depth, video, optical flow.
6. Regenerate `REPORT.md` and record the evidence in `validation.md`.

Integration checkpoint: 22/22 libtorch cells have evidence on the same binary
hash; every non-pass has a cause.

## Phase 2 — PENDING cells

Status: in progress. The 11 LibTensorFlow/LiteRT cells were pre-screened on
infer v0.11.6 via Slurm: 9 pass, `yolo26seg` is KNOWN_BAD on both, and the
remaining `opencv_dnn`/TensorRT cells are blocked. Official browser evidence
still needs current-stack per-backend containers; the CLI pre-screen does not
promote a cell.

## Phase 3 — Failure triage

Status: planned.

Group the remaining FAILED cells:

- OpenCV DNN multi-input graphs (DETR family, OWLv2, OWL-ViT): documented
  unsupported, matching E10 in `BackendCoverage.md`.
- OpenCV DNN and OpenVINO SIGSEGV cells: reproduce with a minimal command,
  capture the stack or the failing stage, and decide backend fix versus
  blocker.
- NERT load failures: confirm the expected model format and whether the
  artifact is supported.
- ONNX Runtime / NERT classification input-size mismatch: check whether the
  fixture or the model signature is wrong.
- TIMEOUT and STALE_FIXTURE cells: re-run once and classify.

Each group gets a decision entry in `artifacts/model-matrix/decisions.json` and
a point in the report.

## Phase 4 — Slurm parallel session

Status: in progress. Session `2026-10-30-matrix-coverage-1` found a broken
LibTorch download URL; the fix is on the 0.11.6 release branch, and the
session is replayed after the tag.

Define one scheduler job per backend build or pre-screening batch, following
the platform runbook and job contract. Pin jobs to the x86 CPU profile, record
the session ID, one evidence envelope per job, and skip offline profiles. Use
the session to build missing backend images and pre-screen model families;
official cells still run against the gated binary.

## Phase 5 — Documentation and release note

Status: planned.

Update `REPORT.md`, `BackendCoverage.md`, and the changelog for any status that
changed. Record blocked and unsupported combinations explicitly. Only then
consider the next release.
