# Packet P3-06 — TIMEOUT + STALE single re-run

Date: 2026-10-31. Repo: `/home/oli/repos/neuriplo-ui` at
`546753566b0dd6cf2b40d667c152319977cb25dd` (equals `origin/master` at run time).
Owner: implementer subagent (DeepSeek V4.1 Flash 1017).

## Scope

17 cells, each given a single-cell browser-matrix attempt on its backend's
gated binary:

| Backend | Cells | Gate binary sha256 | Gate stack |
|---|---|---|---|
| `nert` | yoloseg, rfdetrseg, videomae, vivit, timesformer, raft, rfdetrpose, depth_anything_v2, owlvit, rtdetrul | `83b59ad62f4557b252470cbbe589d6c1335a76d9114a32e9177d6962a918131a` | infer 0.11.2 / core 0.11.1 / tasks 0.8.2 |
| `libtorch` | videomae, vivit, timesformer | `169f89441a89d11ad98649b2bc52f6f95de694ccffb585a53ae446df5a6874bf` | infer 0.11.6 / core 0.11.3 / tasks 0.8.4 |
| `opencv_dnn` | groundingdino, videomae, vivit, timesformer | `49737e78e54bbe367f017631923d684066ff67cf1ce281e1d0450a51b2f20b06` | infer 0.11.6 / core 0.11.3 / tasks 0.8.4 |

The target was one completed attempt per cell. The packet was worked by two
implementer sessions that overlapped at 14:58Z: the `nert` cells came from one
shared sequential driver (one attempt each), the three `libtorch` video cells
were run once (by the continuation pass), and the four `opencv_dnn` cells have
two completed attempts (one from each session). Both `opencv_dnn` attempts
agree on every outcome; the duplicate is disclosed below rather than hidden.

No export, conversion, rebuild, weight substitution, fixture substitution, or
budget change was performed. The run budget stayed at the matrix value
`NEURIPLO_UI_RUN_TIMEOUT_MS=300000` (300 s, 5 min) on port 5182.

## Method

Every attempt was a single-cell invocation of the existing runner:

```
BACKEND=<backend> MODELS=<model> FORCE_MODELS=<model> UI_PORT=5182 \
  node artifacts/model-matrix/browser-matrix.mjs
```

Runs were sequential within each driver (one at a time). The runner asserts
`gate.status == "verified"` and that the container binary hash equals
`gate.binary_sha256` before the run, and re-asserts the binary on success.
`FORCE_MODELS` was set so every attempt is recorded even where prior evidence
would otherwise be reused.

The three `libtorch` video cells were re-run at the unchanged 300 s budget;
the packet's allowance to reference the recorded 900 s `timesformer` run was
used only as supporting evidence, not as a reason to inflate the budget. That
separate experiment completed in 605 s; videomae and vivit were stopped at
300 s in it too.

## Timeline (UTC)

| Time | Event |
|---|---|
| 14:07 | `nert/yoloseg` run; the shared nert driver then continued with rfdetrseg, videomae, vivit, timesformer, raft, rfdetrpose, depth_anything_v2, owlvit, rtdetrul |
| 14:24 | Continuation session re-read state, checked the three gate binaries, started the libtorch 5182 UI (300 s timeout) |
| 14:29 | Continuation driver queued behind the nert driver |
| 14:58:17 | nert pass finished (`DONE`) |
| 14:58:26 | Continuation libtorch/videomae attempt starts |
| 14:58:28 | First-pass `opencv_dnn` driver starts (four cells, 14:58:28–14:59:32) |
| 15:01:40 | First pass wrote its table/decisions and ran `report.py` |
| 15:01–15:23 | Continuation libtorch/vivit and libtorch/timesformer attempts (300 s each) |
| 15:23:25–15:37:12 | Continuation `opencv_dnn` attempts (second pass) |
| 15:37 | Continuation rewrote the table, added this ledger, updated decisions, ran `report.py` once as the last action |

The continuation driver's per-cell idle check matched its own probe shell, so it
waited about 180 s before each run. That delayed starts but did not add a run,
change the 300 s budget, or overlap runs within the libtorch or opencv drivers.

## Result

| Outcome | Count | Cells |
|---|---|---|
| TIMEOUT re-confirmed | 9 | `nert` yoloseg, rfdetrseg, videomae, vivit, timesformer, raft, rfdetrpose, owlvit, rtdetrul |
| TIMEOUT re-confirmed (fresh 300 s run) | 3 | `libtorch` videomae, vivit, timesformer |
| Promoted TIMEOUT → RUNTIME_PASS | 1 | `nert/depth_anything_v2` (inference 286,489 ms, inside budget) |
| Promoted STALE_FIXTURE → RUNTIME_PASS | 3 | `opencv_dnn` videomae, vivit, timesformer (Pexels clips, inference 3,832 / 10,987 / 3,696 ms) |
| TIMEOUT → FAILED | 1 | `opencv_dnn/groundingdino` (single-input backend limit) |

`PENDING` remains 0; `STALE_FIXTURE` is now 0. Full row-per-cell table:
`artifacts/model-matrix/triage-rerun/rerun-table.md`; machine-readable rows:
`rerun-ledger.json` in this directory.

- The nine `nert` timeouts are fresh runs on the gated binary; each reaches
  model load / input setup and then logs nothing until the server kills it at
  the 300 s budget (SIGKILL, `samples: 0`, no inference timing). They reference
  the new decision `nert-cpu-timeout`.
- `nert/depth_anything_v2` was the same family's near-miss: the fresh run
  finished at 286 s inference and produced
  `processed_depth-anything-v2_local.png`
  (`e4b7fd74173e44a13ff4482c1e6df1c004ead9c10e78318527dbdab027b1f8d9`), so it
  is promoted on the measured evidence.
- The three `libtorch` video cells time out again at the unchanged budget, on
  the gated `169f8944…` binary. They keep TIMEOUT and reference
  `libtorch-video-cpu-timeout`.
- `opencv_dnn/groundingdino` exits 1 in ~14 s with the explicit message
  `OpenCV DNN backend currently supports only single input models, got 4 inputs`.
  The old 180 s timeout was recorded on the older `dd26b008…` binary; the
  correct description is the backend's single-input limitation, already recorded
  in `opencv-dnn-two-input-detr`. New decision
  `opencv-dnn-groundingdino-four-input`.
- The three `opencv_dnn` video cells were STALE_FIXTURE because their earlier
  runs used `/workspace/video.mp4` and crashed in frame accumulation on the
  older binary. On the catalog Pexels fixtures with the gated binary they exit
  0, infer, and render 16/32/8-frame MP4s (probed: 320×240, 30 fps), so they are
  promoted with Pexels evidence.

## Concurrent duplicate attempts

The first pass ran the four `opencv_dnn` cells at 14:58:28–14:59:32Z. The
continuation pass ran them again at 15:26–15:36Z because it had queued the same
cells before the first pass's files appeared. Both used the same gated binary,
fixtures, and budget, and both agree:

| Cell | First attempt | Continuation (recorded) | Outcome |
|---|---|---|---|
| `opencv_dnn/groundingdino` | `bc513d0a-9823-4127-9dda-019aec99847d` (16,163 ms) | `eb5dfbda-9ca9-4fe7-b5f1-745b00dccbfe` (13,963 ms) | FAILED, 4 inputs |
| `opencv_dnn/videomae` | `4011d624-1086-4bfa-bfce-d938f4bb74ca` (5,444 ms) | `1213f5d2-4f6c-499d-917a-6992a483742d` (5,361 ms) | RUNTIME_PASS |
| `opencv_dnn/vivit` | `5937b212-32bf-4666-8461-d8a9ae5cf0fc` (13,354 ms) | `f8c8edb6-fe2d-4d2b-9c83-2df14206298f` (13,056 ms) | RUNTIME_PASS |
| `opencv_dnn/timesformer` | `b825e62e-f3cb-4a37-9aea-93aa56bac779` (5,574 ms) | `440e3175-a432-4db2-8a81-c507e7a8f2b0` (5,547 ms) | RUNTIME_PASS |

The per-cell `run.json`, screenshots, artifacts and `results.json` rows now hold
the continuation attempts (the later runs overwrote them); the first attempts
remain in `triage-rerun/logs/opencv_dnn-*.log`. No other cell was attempted
twice.

## Evidence

- `artifacts/model-matrix/triage-rerun/rerun-table.md` — one row per cell with
  the run id, exits, duration, new status and duplicate disclosure.
- `rerun-ledger.json` (this directory) — final machine-readable rows for all 17
  cells, including the duplicate attempt ids.
- `artifacts/model-matrix/triage-rerun/rerun-results.json` — first-pass snapshot.
  Its `nert` rows are current; its `libtorch` and `opencv_dnn` run ids are
  superseded by the continuation runs and must not be quoted as current.
- `artifacts/model-matrix/triage-rerun/matrix-reasons.json` — first-pass reason
  reference; the `nert` rows are current, the `opencv_dnn` run ids are the
  superseded first attempt.
- `artifacts/model-matrix/triage-rerun/pre-rerun.json` — evidence snapshot
  before the attempts.
- `artifacts/model-matrix/triage-rerun/fixture-sha256.txt` — fixtures unchanged;
  values match every recorded row's `fixture_sha256`.
- `artifacts/model-matrix/triage-rerun/logs/` — nert logs and the first opencv
  pass (plus the two first-pass drivers).
- `logs/` in this directory — continuation libtorch and opencv logs, the driver
  log and `summary-libtorch-opencv.tsv`.
- Official runs now in `<backend>/<model>/run.json` and the corresponding
  `results.json` rows; rendered artifacts under each `opencv_dnn/<model>/` and
  `nert/depth_anything_v2/` directory.
- Decisions: `nert-cpu-timeout`, `opencv-dnn-groundingdino-four-input` in
  `artifacts/model-matrix/decisions.json`; `libtorch-video-cpu-timeout` evidence
  extended with the fresh 2026-10-31 runs.

## Run ledger

| # | Action | Invocation | Outcome |
|---|---|---|---|
| 1 | Read state | `matrix.json`, `report.py`, `browser-matrix.mjs`, `decisions.json`, 17 `run.json`, per-backend `gate.json` | 14 TIMEOUT + 3 STALE identified; `report.py` derives status from `run.json` |
| 2 | Verify inputs | `sha256sum` over fixtures and target weights; `docker exec … sha256sum` on the three gated binaries | fixtures and binaries matched the recorded gates; no substitution |
| 3 | Prepare containers | nert server already on 5182 (300 s budget); started opencv_dnn and libtorch 5182 servers with `start-server-5182.py` | servers HTTP 200; env confirmed 300000 ms |
| 4 | Browser smoke test | Playwright goto to the nert UI, visibility check only | UI served; no matrix run consumed |
| 5 | `nert/yoloseg` | `BACKEND=nert MODELS=yoloseg FORCE_MODELS=yoloseg …` | TIMEOUT, run `f774bf10-7d36-41e1-b95a-020c42a4d453`, 300,074 ms |
| 6 | Remaining 9 `nert` cells | `triage-rerun/rerun-nert.sh` (sequential) | 8 TIMEOUT; `depth_anything_v2` RUNTIME_PASS, run `ab76e529-3515-40dc-8403-3ef7f54f96b4`, 288,014 ms |
| 7 | 4 `opencv_dnn` cells (first pass) | `triage-rerun/rerun-opencv_dnn.sh` (sequential) | 3 video cells RUNTIME_PASS; `groundingdino` FAILED at load, run `bc513d0a-9823-4127-9dda-019aec99847d` |
| 8 | 3 `libtorch` video cells (continuation) | `BACKEND=libtorch MODELS=<model> FORCE_MODELS=<model> …` | TIMEOUT at 300 s; runs `bc831dfa…`, `22f7ab2f…`, `f883bb0e…` |
| 9 | 4 `opencv_dnn` cells (continuation) | `BACKEND=opencv_dnn MODELS=<model> FORCE_MODELS=<model> …` | same outcomes as the first pass; runs `eb5dfbda…`, `1213f5d2…`, `f8c8edb6…`, `440e3175…` |
| 10 | Verify artifacts | `ffprobe` on the three MP4s; PNG dimensions; run reports and post-run binary hashes | 320×240, 30 fps, 16/32/8 frames; positive inference on all promoted cells |
| 11 | Decisions | appended `nert-cpu-timeout`, `opencv-dnn-groundingdino-four-input`; extended `libtorch-video-cpu-timeout` evidence | `decisions.json` valid JSON, 13 entries |
| 12 | Evidence files | rewrote `rerun-table.md`; wrote `rerun-ledger.json`, this packet | complete |
| 13 | Final scoreboard | `python3 artifacts/model-matrix/report.py`, once, as the last action | result reported to the orchestrator |

## Provenance limitations

- The `nert` gate record (`gate.json`) was verified on the 2026-10-27 build
  (infer 0.11.2 / core 0.11.1 / tasks 0.8.2) at UI commit `ba819b9…`, which
  predates the current `origin/master` (`5467535…`). This packet re-asserts the
  recorded gate binary hash and runs on that exact binary; it does **not** claim
  a fresh release-stack gate. The served UI source files still hash-match the
  gate (`App.tsx` `337ee022…`, `runner.ts` `ba25a8d0…`). A fresh nert build
  belongs to a separate remediation packet.
- The `libtorch` and `opencv_dnn` gates are the current 0.11.6 / 0.11.3 / 0.8.4
  stack; their served UI source hashes also match the gate records.
- `report.py` regenerates `matrix.json` and `REPORT.md`. It derives the reason
  for FAILED/TIMEOUT cells from the current `run.json`; `matrix-reasons.json`
  is a human reference, not an input to `report.py`. `reviews.json` overlays
  only RUNTIME_PASS/PENDING cells, and none of the 17 cells has a review entry.
- No `git tag` or push. `artifacts/` is ignored by git; only this packet
  directory is added to the working tree. The runner wrote the permitted
  `run.json`/artifact evidence and `results.json` rows; the final `report.py`
  wrote `matrix.json`/`REPORT.md`.
