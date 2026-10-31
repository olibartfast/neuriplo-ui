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

Status: done. The per-backend containers were rebuilt on the current stack
(infer v0.11.6 / core v0.11.3 / tasks v0.8.4) and all 13 cells now have
official browser evidence. `yolo26seg` is KNOWN_BAD on both TensorFlow
backends (empty export); everything else passes.

## Phase 3 — Failure triage

Status: done (2026-10-31). 13 decisions in
`artifacts/model-matrix/decisions.json`, all PENDING closed, P3-06 single
re-run banked: 4 promotions (`nert/depth_anything_v2`, `opencv_dnn` video
trio on Pexels footage), 1 reclassification (`opencv_dnn/groundingdino`
fast single-input refusal), 12 confirmed CPU timeouts, stale-stack pair
(`onnx_runtime` + `nert` tensorflow-classifier) promoted after container
rebuilds on the release stack. Matrix: 176 RUNTIME_PASS / 22 FAILED /
12 TIMEOUT / 10 KNOWN_BAD / 159 EXPORT_BLOCKED / 51 NOT_APPLICABLE.

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

Status: done as pre-screen/build only (D-1: official evidence uses the
gated binary). Session `2026-10-30-matrix-coverage-1` found the broken
LibTorch URL fixed on the 0.11.6 branch. Session
`2026-10-31-ort-rebuild-1`: `sbatch` unreachable from this host
(client/controller version mismatch), routed per runbook via SSH; remote
`onnxruntime` image build failed (GPU tgz wget exit 8); local container
rebuilds are the evidence that counts. `nert` has no Dockerfile.

Define one scheduler job per backend build or pre-screening batch, following
the platform runbook and job contract. Pin jobs to the x86 CPU profile, record
the session ID, one evidence envelope per job, and skip offline profiles. Use
the session to build missing backend images and pre-screen model families;
official cells still run against the gated binary.

## Phase 5 — Documentation and release note

Status: done (2026-10-31, docs only, no statuses changed). `REPORT.md`
regenerated from the gated runs (counts above); `BackendCoverage.md`
header refreshed to the 0.11.6 stack with the new blockers recorded
(single-input limit incl. 4-input groundingdino, EC GELU importer crash,
OpenVINO video 5D crash) and a pointer to the 13 ui-matrix decisions;
infer `CHANGELOG.md` Unreleased gains a Documentation entry. No release
without explicit user order.

Update `REPORT.md`, `BackendCoverage.md`, and the changelog for any status that
changed. Record blocked and unsupported combinations explicitly. Only then
consider the next release.
