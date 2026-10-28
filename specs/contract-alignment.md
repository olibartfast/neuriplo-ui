# Current contract alignment

Requirement: consume the current producer contract only, including diagnostic
report metadata. Version identifiers are internal compatibility details, not
user-facing choices. No legacy fallback.

Validation defined before implementation: build and unit suites; reject incompatible
contracts and malformed diagnostics; exercise the real binary in Google Chrome.
A failed terminal run proves submission wiring, not successful model inference.

Validated 2026-10-26:
- `npm run build`: passed.
- `npm test`: 17 web and 55 server tests passed, including incompatible contract
  rejection and malformed diagnostics cases.
- Google Chrome via Playwright: all 8 E2E checks passed against the real binary.
  The producer display has no schema identifier.
- Submission E2E now fills required controls only; optional controls are collapsed.
- Evidence: `/tmp/neuriplo-ui-browser-report/index.html`, screenshots under
  `/tmp/neuriplo-ui-browser-results`, unit log `/tmp/neuriplo-ui-v2-unit.log`.
- The generic submission E2E uses nonexistent fixture/weights and accepts a failed
  run. Successful real inference was validated separately as follows.

Real inference validated 2026-10-26 through installed Google Chrome:
- UI `http://127.0.0.1:5177`, isolated adapter on port 5176, binary
  `/home/oli/repos/neuriplo-infer/build-dnn5/app/neuriplo-infer` (OpenCV 5).
- Object detection, selector `yolo11`, local CPU OpenCV DNN;
  weights `/home/oli/repos/neuriplo-infer/models/trt-video/yolo11s.onnx`,
  input `/home/oli/repos/neuriplo-infer/data/bus.jpg`, input sizes `3,640,640`,
  no display enabled, remaining parameters at UI defaults.
- Run `898b1e81-1fea-4794-b22c-233eb50bccd1`: success, exit 0, no timeout;
  inference log 393 ms, adapter duration 950.958 ms.
- Chrome asserted Succeeded, loaded image preview with positive natural width,
  and HTTP success for both downloaded artifacts. Screenshot visually inspected:
  annotated bus and people detections displayed in the UI.
- Evidence and runnable browser script:
  `/tmp/neuriplo-ui-real-inference.mjs`,
  `/tmp/neuriplo-ui-real-inference/run.json`,
  `/tmp/neuriplo-ui-real-inference/result.png`,
  `/tmp/neuriplo-ui-real-inference/data_output_processed_yolo11_local.png`,
  `/tmp/neuriplo-ui-real-inference/data_output_run_report.json`.
  Reproduce with `node /tmp/neuriplo-ui-real-inference.mjs` while the isolated
  UI/adapter are running.
- Limitation: the original `build/app/neuriplo-infer` uses OpenCV 4.6 and failed
  YOLO11 execution with a shape assertion even with CHW input sizes. Success is
  validated with the existing OpenCV 5 binary, not that original build. No
  backend implementation or sibling repository was changed.

Version audit 2026-10-26 (GitHub releases and remote branch heads checked live):
- Latest releases: neuriplo-infer v0.11.2, neuriplo v0.11.1,
  neuriplo-tasks v0.8.2. Local clean source checkouts: infer develop at
  1192ea18dac3b85a8f118e7faa95e5b52c045b96 (0.11.2), neuriplo master at
  d4854ccd87a4072ae74a30d05bb48bbee72dae75 (0.11.1), tasks develop at
  c175760 (0.8.3-dev), two documentation commits behind remote develop e781f0f.
- Current infer versions.env pins neuriplo v0.11.1 and tasks v0.8.2, matching
  their latest releases. Independent version numbers are intentional.
- Both tested executables actually advertise infer 0.10.3, confirmed by
  --capabilities; neither validates the current infer 0.11.2 release.
- Original build cache: neuriplo v0.8.0, tasks v0.8.0, VideoCapture v0.5.0.
  OpenCV 5 build cache: neuriplo v0.10.0, tasks v0.8.2, VideoCapture v0.6.0.
  Both caches override neuriplo/tasks source directories with sibling checkouts.
  Cache refs therefore do not prove exact dependency revisions compiled into
  the existing binaries; those revisions remain uncertified.
- The successful browser run remains valid evidence for the tested binary only.
  Validation of the current released stack requires a fresh, provenance-checked
  build and a repeat real-inference Chrome run.

Fresh-release validation subsequently completed 80 successful Chrome UI
inferences on infer 0.11.2, neuriplo 0.11.1 and tasks 0.8.2. The older 0.10.3
run above remains historical evidence only.

Current-stack validation 2026-10-28 (infer 0.11.3, neuriplo 0.11.2,
tasks 0.8.2, CPU OpenCV DNN 5.0.0): isolated release checkouts, fresh
configured build, `validate:stack --rebuild` passed (exit 0, manifest
`neuriplo-ui-provenance.json` in the new build dir). Real Chrome inference
through the UI on the verified binary (hash matches the manifest):
object detection `yolo11` on `bus.jpg` with `yolo11s.onnx` and `3,640,640`
CHW input, run `bd53a05f-da45-4d9b-a926-f3a764427384`, status success,
exit 0, 10.75 s adapter duration (375 ms logged inference, 9.98 s one-time
model load). Annotated bus/people preview loaded (positive natural width)
and both artifacts downloaded over HTTP. Evidence:
`/tmp/neuriplo-0.11.3-chrome.mjs`,
`/tmp/neuriplo-0.11.3-browser/{run.json,result.png,hashes.json,data_output_*}`,
gate log `/tmp/neuriplo-stack-0.11.3-gate.log`.
Unit suites: web 86/86, server 87/87.
