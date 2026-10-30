# Matrix coverage — task models × backends

## Why

The model/backend matrix is the release gate for runtime correctness: a green
gate proves the stack was built from the right sources, not that each model
still produces a correct result. The 0.11.3 TorchScript input-datatype contract
and the 0.8.4 decoder fix changed that matrix in two directions: the DETR
family now works, while older TorchScript archives are rejected until they are
re-exported. The remaining cells need the same treatment instead of staying
stale or unexplained.

## Scope (in)

- Re-export the 17 legacy TorchScript artifacts with input-datatype metadata and
  re-run their libtorch cells on the gated release stack.
- Execute or classify the 13 PENDING cells.
- Triage the remaining FAILED cells into backend limitation, model defect, or
  fixture defect, with evidence.
- Use the platform Slurm cluster for parallel backend builds and pre-screening
  where it does not change the evidence binary.
- Keep the coverage report and the backend documentation in step with the
  results.

## Scope (out)

- New UI features and backend implementations beyond the triage fix.
- Model training, tolerance changes, or silent model substitutions.
- Publishing a release while the affected matrix cells are unclassified.

## Requirements

- **R-1** Every libtorch cell on the current release stack has fresh evidence
  and a typed artifact, or a documented blocker.
- **R-2** Every cell that does not pass has a recorded cause and a pointer to
  the owning repository or decision. A bare FAILED or PENDING is not an
  acceptable final state.
- **R-3** The 13 PENDING cells are run on the current stack or classified with
  the missing prerequisite (fixture, model, backend, or hardware).
- **R-4** Slurm jobs follow `neuriplo-platform`'s scheduler job contract: one
  identity per job, evidence envelope per job, offline profiles skipped rather
  than failed. No hostnames, addresses, or private paths reach tracked files.
- **R-5** The coverage report, decisions, and `BackendCoverage.md` describe the
  state actually measured; no cell claims more than its evidence.

## Decisions

- **D-1** Official matrix evidence runs the gated binary
  (`d72f88d2…`, infer 0.11.5 / core 0.11.3 / tasks 0.8.4). A Slurm job that
  builds a different binary is pre-screening only and cannot promote a cell.
- **D-2** A legacy TorchScript archive is re-saved with
  `scripts/lib/torchscript_metadata.py` using the real example shapes and
  dtypes. If the input contract cannot be established, the cell is marked
  BLOCKED rather than guessed.
- **D-3** Slurm profiles that are offline or unreachable are recorded as
  `skipped`, not failed. The local gated run remains the evidence source.

## Open questions

- **Q-1** Which of the 17 legacy archives can be re-saved without access to
  their original export scripts? The example shapes and dtypes are known from
  the recorded run commands; anything ambiguous is blocked, not assumed.
- **Q-2** Which remaining FAILED cells are backend defects worth fixing now,
  and which are documented limitations (multi-input OpenCV DNN, older engine
  formats) that belong in the coverage notes?

## Findings

- The 2026-10-30 Slurm check found the `cpu` partition up with two idle nodes
  and one down. The x86 node has 16 CPUs, Docker, and the libtorch 2.3 CPU SDK;
  there is no libtorch infer image and no Python torch environment. Builder
  images exist for OpenVINO, LibTensorFlow, and llama.cpp. This is enough for
  parallel builds and pre-screening, not for reproducing the gated binary.
- All 17 legacy archives expose a single tensor input except `raft`, which
  takes two images. Their recorded input sizes are in the matrix run commands.
