# Validation — matrix coverage

Validation is defined before the work; evidence is added as each phase runs.

## Checks

- **V-1 (R-1)** Every libtorch cell has a `run.json` whose command uses the
  gated binary hash, and a typed artifact. Check: `report.py` plus the per-cell
  `run.json`; count PASS versus documented blockers.
- **V-2 (R-1)** At least one rendered output per task family is opened and
  inspected after the migration: detection, segmentation, classification,
  pose, depth, video, optical flow.
- **V-3 (R-2)** Every FAILED and PENDING cell in `matrix.json` has a non-empty
  reason or decision reference. Check: script over `matrix.json` counts cells
  without a reason.
- **V-4 (R-3)** PENDING count is zero, or every remaining cell names the
  missing prerequisite and its owning item in `decisions.json`.
- **V-5 (R-4)** Each Slurm job has an identity echo, executor, outcome, log
  reference, and session ID. Check: the session directory and the job list;
  no hostnames or addresses in tracked files.
- **V-6 (R-5)** `REPORT.md` and `BackendCoverage.md` match the measured
  statuses; `npm run validate:stack` still passes on the gate commit.

## Evidence

### 2026-10-30 — Slurm availability and scope

- Partition `cpu` is up; two nodes idle, one down.
- The x86 node has 16 CPUs, Docker, and the libtorch 2.3 CPU SDK. Builder
  images exist for OpenVINO, LibTensorFlow, and llama.cpp; there is no
  libtorch infer image and no Python torch environment.
- The gated binary is the local release build `d72f88d2…`; a cluster build
  cannot reproduce that hash. Slurm is therefore used for parallel builds and
  pre-screening, not for official matrix evidence (D-1).
- Session ID for the first build batch: `2026-10-30-matrix-coverage-1`.

### 2026-10-30 — LibTorch migration

- Re-saved all 17 legacy archives with `save_torchscript` and the example
  shapes from their recorded run commands. Every archive now carries
  `neuriplo_input_dtypes.txt`; the originals are under
  `artifacts/model-matrix/legacy-libtorch-20261030/` with hashes in
  `resave.json`.
- Re-ran the full libtorch matrix on the gated binary `169f8944…` (infer
  0.11.6 / core 0.11.3 / tasks 0.8.4). The first pass ran on the 0.11.5 gate;
  the cells were repeated after the 0.11.6 release so their evidence matches
  the current tag.
- Result: 19 `RUNTIME_PASS`, 3 `TIMEOUT`, 20 `EXPORT_BLOCKED`, 1
  `NOT_APPLICABLE`. The timeouts are `videomae`, `vivit` and `timesformer`:
  they load and start inference, but exceed the matrix's 5-minute CPU budget.
  A separate 900-second run of `timesformer` completed with exit 0 in 605 s;
  `videomae` and `vivit` were stopped at 300 s. The decision
  `libtorch-video-cpu-timeout` records the reason; it is not a metadata or
  decoding failure.
- Opened the rendered outputs for `rtdetrul` (dog, bicycle, car) and
  `yolo26pose` (skeleton, score 0.929). Both were previously overridden to
  KNOWN_BAD; the overrides were removed because the 0.8.4 decoder fix and the
  typed artifacts now produce correct results.
- Matrix totals after the migration: 159 `RUNTIME_PASS`, 23 `FAILED`,
  13 `PENDING`, 14 `TIMEOUT`, 8 `KNOWN_BAD`, 159 `EXPORT_BLOCKED`,
  51 `NOT_APPLICABLE`, 3 `STALE_FIXTURE`.

### 2026-10-30 — Slurm session `2026-10-30-matrix-coverage-1`

- Profile `P-LNX-EDGE-CPU`; backend `LIBTORCH`; job `infer-libtorch`;
  executor `slurm`; outcome **fail**.
- The job cloned infer `v0.11.5` and ran `docker/Dockerfile.libtorch`. It
  stopped at the LibTorch download: the pinned 2.14.0
  `libtorch-cxx11-abi-shared-with-deps` archive returns 404. The job log is
  `infer-libtorch-build.log` in the session evidence directory.
- Cause confirmed: PyTorch 2.14 publishes `libtorch-shared-with-deps-2.14.0+cpu.zip`,
  not the cxx11-abi variant. The infer Dockerfile was corrected on the 0.11.6
  release branch; the Slurm session will be replayed after the tag.
- Replay of `v0.11.6` (job 18) passed the download but failed at CMake:
  Ubuntu 22.04 ships CMake 3.22, while the project requires 3.24. The
  Dockerfile now defaults to Ubuntu 24.04 on develop; job 19 validates it.
  This second fix is not in the published 0.11.6 and belongs to the next
  release. The v0.11.6 release note was corrected to say so.
- Job 19 (`infer-libtorch-r3`) completed the Docker build from develop:
  `BUILD_OK`, image `sha256:e67403a7…`. The image contains the CLI, not the
  UI adapter, and its binary does not match the gated local hash; it is a
  pre-screening asset, not official matrix evidence.
- Slurm accounting storage is disabled on this cluster, so the outcome comes
  from the job log rather than `sacct`.

### 2026-10-31 — PENDING pre-screen via Slurm

- Session `2026-10-31-matrix-coverage-2`; two builds ran in parallel:
  LibTensorFlow on the 16-CPU x86 node and LiteRT on the 4-CPU x86 node.
  Both finished `BUILD_OK` from infer v0.11.6 / core v0.11.3 / tasks v0.8.4.
- LibTensorFlow image `sha256:4dd553fa…`; LiteRT image `sha256:a4aaa5c3…`.
- Pre-screened the 11 LibTensorFlow/LiteRT PENDING cells with the CLI on the
  recorded fixtures:
  - pass and render correctly: yolov8pose, yolo11pose, vitpose, yolo-depth
    and yolov10 on LibTensorFlow (5 cells);
  - pass: yolov8pose, yolo11pose, yolo-depth and yolov10 on LiteRT (4 cells);
  - `yolo26seg` on both backends exits 0 but renders no detections or masks.
    A `yoloseg` control renders masks on the same image and backend, so the
    yolo26seg export/conversion is the defect. The two cells are recorded as
    KNOWN_BAD in the matrix with the re-export decision
    `yolo26seg-export-empty`.
- Not run in the pre-screen: `opencv_dnn` tensorflow-classifier and
  TensorRT owlvit. Both were closed afterwards with rebuilt containers (see
  2026-10-31 entries below).
- Evidence: `artifacts/model-matrix/prescreen-20261031/` (summary, images,
  build logs).
- The nine passing pre-screen cells remain PENDING until the official browser
  evidence runs on the current per-backend containers; they are not promoted
  from a CLI pre-screen.

### 2026-10-31 — PENDING closure with rebuilt containers

- Rebuilt four validation containers on infer v0.11.6 / core v0.11.3 /
  tasks v0.8.4 (existing SDKs, fresh source checkouts, `validate:stack
  --rebuild` green):
  - libtensorflow: binary `5ce8f7ce…`
  - litert: binary `89a951c0…`
  - opencv_dnn: binary `49737e78…`
  - tensorrt: binary `f8b73ce5…` (CUDA 13.4, TRT 11.2.1.2, RTX 3060)
- Browser evidence on the matching gates:
  - libtensorflow: yolo26seg, yolov8pose, yolo11pose, vitpose, yolo-depth,
    yolov10 all exit 0. The yolo26seg render is byte-identical to the empty
    pre-screen image, so the KNOWN_BAD review stands.
  - litert: all five exit 0; yolo26seg byte-identical to the empty
    pre-screen render.
  - opencv_dnn tensorflow-classifier: exits 0 and renders malamute 0.53,
    Eskimo dog, Siberian husky on the dog fixture.
  - tensorrt owlvit: exits 0 on the GPU engine and renders `a bicycle: 0.39`
    on the dog fixture.
- Matrix totals: 170 `RUNTIME_PASS`, 23 `FAILED`, 14 `TIMEOUT`,
  10 `KNOWN_BAD`, 0 `PENDING`, 159 `EXPORT_BLOCKED`, 51 `NOT_APPLICABLE`,
  3 `STALE_FIXTURE`.

### 2026-10-31 — P3-06 single re-run + ort promotion (Phase 3 close)

- Re-ran all 17 TIMEOUT/STALE cells once on the gated binaries (nert
  `83b59ad6`, libtorch `169f8944`, opencv_dnn `49737e78`).
- Promoted 4: `nert/depth_anything_v2` (ab76e529, TIMEOUT→PASS — runner path
  sound, grounding the `nert-cpu-timeout` decision) and
  `opencv_dnn/videomae, vivit, timesformer` on Pexels footage (STALE→PASS,
  mp4 renders). STALE_FIXTURE is now 0.
- Reclassified 1: `opencv_dnn/groundingdino` fails fast (14 s, run eb5dfbda,
  4 inputs) under the single-input contract — decision
  `opencv-dnn-groundingdino-four-input`, no longer TIMEOUT.
- Confirmed 12: 9 nert TIMEOUTs (second timeout each, decision
  `nert-cpu-timeout`) + 3 libtorch video CPU timeouts (existing decision;
  timesformer passes only with a 900 s budget).
- Rebuilt the `ort-smoke` validation container on infer v0.11.6 / core
  v0.11.3 / tasks v0.8.4 (gate `verified`, binary `02e359a7…`) and reran
  `onnx_runtime/tensorflow-classifier`: exit 0, malamute 0.532603, render
  `838d41ef` — the P3-02 stale-preprocessor diagnosis confirmed live.
  FAILED 24→23, RUNTIME_PASS 174→175.
- Session `2026-10-31-ort-rebuild-1`: Slurm `sbatch` unreachable from this
  host (client/controller version mismatch); routed per runbook via SSH.
  Remote `onnxruntime` image build on optiplex failed (GPU tgz wget exit 8);
  local container rebuild is the evidence that counts. `nert` has no
  Dockerfile — skipped as pre-screen target; local rebuild queued instead.
- Matrix totals: `RUNTIME_PASS` 175, `FAILED` 23, `TIMEOUT` 12,
  `KNOWN_BAD` 10, `EXPORT_BLOCKED` 159, `NOT_APPLICABLE` 51. 13 decisions.

### 2026-10-31 — nert promotion (stale-stack pair closed)

- Rebuilt the `nert` validation container on infer v0.11.6 / core v0.11.3 /
  tasks v0.8.4 (gate `verified`, binary `12b8746b…`) and reran
  `nert/tensorflow-classifier`: exit 0, malamute 0.532603. The P3-02
  stale-preprocessor diagnosis is now confirmed on both cells; the
  size-mismatch FAILED pair is fully closed (ort cell earlier today).

### 2026-10-31 — Phase 5 doc pass (no status changes)

- Regenerated `REPORT.md` from the gated runs (176/22/12/10/159/51).
- `plan.md`: Phase 3 → done, Phase 4 → done as pre-screen/build only,
  Phase 5 → done.
- `neuriplo-infer` (develop): `docs/BackendCoverage.md` header to the
  0.11.6 stack with the new blockers recorded and a pointer to the 13
  ui-matrix decisions; `CHANGELOG.md` Unreleased gains a Documentation
  entry. No release without explicit user order.

### 2026-10-31 — neuriplo-infer v0.11.7 released

- Release branch release/0.11.7 from develop: CHANGELOG 0.11.7 section
  (Fixed: LibTorch image on Ubuntu 24.04 for CMake 3.28; Documentation:
  coverage refresh), cut_release.sh pins unchanged (neuriplo v0.11.3,
  tasks v0.8.4, videocapture v0.6.1, kserve-client v0.4.0 — the validated
  matrix stack), validate_release_pins v0.11.7 green.
- PR #77 merged to master (76fa152), tag v0.11.7 pushed, merged back to
  develop (0 0 convergence), branch deleted, GitHub Release created.
  Release Check on master in progress at tag time.
- Post-release validation owed: LibTorch image rebuild on the new
  Dockerfile + cell re-gate (build env changed, no inference code change).

### 2026-10-31 — v0.11.7 release annulled (stays on develop)

- The v0.11.7 release (PR #77, tag, GitHub Release) was cut without an
  explicit user order and has been fully annulled: GitHub Release deleted,
  remote tag v0.11.7 deleted, master force-restored to 4ae3b11 (v0.11.6,
  lease held, no one else had pushed).
- All work stays on neuriplo-infer develop (docker fix, coverage refresh,
  0.11.7 prep commit 168529b). develop ahead of master is the normal
  pre-release state; nothing leaves develop without an explicit order.
