# Packet P3-02 — tensorflow-classifier input-size triage

Date: 2026-10-31. Repo: `/home/oli/repos/neuriplo-ui`.
Owner: implementer subagent (DeepSeek V4.1 Flash 1017).
Status: complete — evidence and decision written; both cells stay `FAILED`.

## Scope

Cells: `onnx_runtime/tensorflow-classifier` and
`nert/tensorflow-classifier`, both failing with a 602112-vs-150528 input-size
mismatch on `tensorflow-classifier.onnx`.

Goal: decide whether the model signature or the fixture is wrong, or whether a
stale component in the validation containers supplies the wrong buffer. No
re-probe of containers in this packet: the raw probes were already taken and
were re-read here.

Writable paths used:

- `artifacts/model-matrix/triage-tfcls-size/` — `evidence.md`, `README.md`,
  `matrix-reasons.json` (and the existing `raw/`, left verbatim)
- this packet directory — `packet.md`
- `artifacts/model-matrix/decisions.json` — one new entry
- `artifacts/model-matrix/matrix.json` — reason text for the two cells only

Read-only inputs: `matrix.json`, `decisions.json`, `catalog.json`,
`reviews.json`, `report.py`, the two cells' `run.json`,
`tensorflow-classifier-reference.json`, and the read-only source copies under
`artifacts/installer/workspace/`.

## Deliverables

| obligation | artefact |
|---|---|
| verdict with model, fixture and stack separated | `artifacts/model-matrix/triage-tfcls-size/evidence.md` |
| short index with key hashes and caveats | `artifacts/model-matrix/triage-tfcls-size/README.md` |
| durable copy of the intended cell reasons (report.py regenerates them from `run.json`) | `artifacts/model-matrix/triage-tfcls-size/matrix-reasons.json` |
| decision covering both cells, scope naming both cells | `artifacts/model-matrix/decisions.json` → `tf-classifier-input-size` |
| decisions surfaced in the generated report | `decisions.json` is concatenated into `matrix.json.decisions` and `REPORT.md` by `report.py` |

## Result

- Model correct: `tensorflow-classifier.onnx`
  `sha256:6997ff86f36c133a67aa457ad0655ade931cd0bfde77cee6e821b9c8ae913275`,
  producer tf2onnx 1.17.0, opset 18, one FLOAT input `image`
  `[1,224,224,3]` NHWC = 602112 bytes, output `Identity:0 [1,1000]`.
- Fixture correct: `dog.jpg`
  `sha256:5a9522051c3cec2bbd2f6323fccba32e8fbf3ddcc2b3e2fd46b04c720bc6f866`,
  576x768x3 in both the failing and the passing logs.
- Failing cause: tasks v0.8.2 preprocessed to NHWC UINT8, supplying 150528 bytes
  (224x224x3 at one byte) to the FLOAT input; both runtimes reject the bind.
- Control: `opencv_dnn` on tasks v0.8.4 / infer v0.11.6 / core v0.11.3 with the
  same ONNX and JPEG exits 0, infers in 136 ms and renders malamute 0.53, the
  native float32 reference top-1 (0.5324).
- Owner: the neuriplo-ui validation containers, `neuriplo-ui-installer-ort-smoke`
  and `exciting_vaughan`, both still on tasks 0.8.2 (the fresh probes reproduce
  the identical error), so the archived rows are not the only stale part — the
  containers are.
- Action: rebuild both containers on tasks >= 0.8.4 and re-run the two cells via
  the gated browser matrix; expect the reference top-1 with positive inference
  time. Until then the cells remain `FAILED`.

## Relation to other cells

`openvino`, `libtensorflow` and `litert` tensorflow-classifier are `KNOWN_BAD`
with reasons describing the same NHWC/UINT8-versus-metadata family of defect.
Their statuses come from `reviews.json`, are out of this packet's writable
scope, and were left untouched; they belong to the same container-rebuild pass.
`opencv_dnn/tensorflow-classifier` already passes on tasks 0.8.4 and served as
the control.

## Constraints honoured

- No container probe, rebuild, image change, or re-run; `raw/` is verbatim.
- No `browser-matrix.mjs` run: it would rewrite `<backend>/<model>/run.json` and
  the PNGs, which are read-only for this packet.
- No `neuriplo-*` edit. No `git tag`/`push` (`artifacts/` is gitignored in this
  repo, so nothing here is stageable; `specs/` was left uncommitted too).
- Statuses untouched: `FAILED` for both cells, all other cells unchanged
  (counts identical before and after the edit).
- `matrix.json` was edited only for the two reasons; `report.py` then regenerated
  the file from `run.json` + `reviews.json`, which drops that text — the durable
  reason and the decision scope link are therefore in `decisions.json` and
  `triage-tfcls-size/matrix-reasons.json`.

## Run ledger

Wall clock: 2026-10-31 ~15:05–15:25 UTC. Ten shell invocations, four file
writes, one decision edit, one `matrix.json` edit, one acceptance run.

| # | step | outcome |
|---|---|---|
| 1 | list triage dir, packet dirs, raw evidence | 6 raw files (2 stdout empty), no packet file yet |
| 2 | read all raw logs | 602112 vs 150528 on both cells; control at 0.8.4 exits 0, 136 ms |
| 3 | read `decisions.json`, `report.py` | 7 existing decisions; `report.py` rebuilds `matrix.json` reasons from `run.json`, so reason edits do not survive |
| 4 | read `matrix.json` tensorflow-classifier cells | both `FAILED` at stage `inference`; `KNOWN_BAD` notes on the other three TF backends describe the same mismatch |
| 5 | read `reviews.json` and the two sibling packets | `KNOWN_BAD` reasons are review-supplied; packet style: scope, deliverables, findings, constraints, ledger |
| 6 | read the two `run.json` files and the `opencv_dnn` pass | run logs dated 2026-10-28 10:10 / 10:22 (tasks 0.8.2); the pass at 12:43 is 2026-10-31 on 0.8.4 |
| 7 | read `tensorflow-classifier-reference.json` | reference top-1 malamute 0.5324; tflite max abs diff 1.2e-05 |
| 8 | read v0.8.3 and v0.8.4 task sources (local copies) | `classification_task.cpp:26-32` builds the preprocessor from `input_formats`/`input_types` + `applyImageInputType`; the one-arg tensorflow ctor still defaults to NHWC/UINT8 |
| 9 | hash the local ONNX and JPEG | `6997ff86…` and `5a952205…` — exact match with the in-container provenance |
| 10 | arithmetic | `224*224*3 = 150528`; `*4 = 602112` — the "got" buffer is UINT8 NHWC, the "expected" is FLOAT NHWC |
| 11 | write `evidence.md` | full triage, provenance table, action and acceptance criteria |
| 12 | write `README.md`, `matrix-reasons.json` | index + durable intended reasons |
| 13 | append decision `tf-classifier-input-size` to `decisions.json` (final position, two wording fixes) | 8 decisions; scope names both cells |
| 14 | update the two `matrix.json` reasons, verify statuses | statuses still `FAILED`; counts unchanged |
| 15 | acceptance `python3 artifacts/model-matrix/report.py`, run exactly once as the final action | result reported to the orchestrator; no repair applied afterwards |

Outcome: triage complete. Model and fixture are correct; the blocker is the
stale task preprocessor in the two validation containers, with the fix already
released in tasks >= 0.8.4. The two cells remain `FAILED` pending a container
rebuild and a gated re-run.
