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
- Re-ran the full libtorch matrix on the gated binary `d72f88d2…`.
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
- Slurm accounting storage is disabled on this cluster, so the outcome comes
  from the job log rather than `sacct`.
