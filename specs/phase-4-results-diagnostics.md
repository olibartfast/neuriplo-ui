# Phase 4 — Results and diagnostics

## Outcome

After a run reaches a terminal state, the browser must show enough information
to inspect its output, understand its performance boundary, diagnose a failure,
and reproduce the exact invocation outside the UI.

Phase 4 is complete when the UI can:

- render a structured result whenever `neuriplo-infer` emits one;
- report adapter-observed wall-clock duration without labelling it inference
  latency;
- show and copy the exact command using safe POSIX shell quoting;
- expose stdout and stderr in accessible, collapsible log views;
- distinguish request rejection, timeout, termination, and a staged pipeline
  failure when the producer supplies a machine-readable stage;
- consume producer-supplied latency and throughput metrics without scraping
  logs or task-specific artifacts.

## Current contract boundary

`POST /api/runs` already returns the following fields needed by this phase:

```text
status
run_id
task / model / execution / source
command.bin / command.args
exit_code / signal / timed_out
duration_ms
artifacts
result
stdout / stderr
error.code / error.message
```

The existing `duration_ms` is measured by the adapter around the complete child
process. It includes startup, model loading, source handling, inference,
postprocessing, rendering, and shutdown. The UI must call it **wall time**, not
inference latency.

The live CLI only produces parseable stdout for workflows that advertise and
use `--output_format=json`; most visual tasks currently communicate predictions
through rendered artifacts. A null `result` is therefore an expected state,
not a failed parse.

Two requested features do not yet have reliable machine-readable inputs:

1. Per-stage latency, FPS, throughput, sample count, and benchmark summaries.
2. Failure attribution to configuration, model load, inference, or
   postprocess.

Phase 4 must not infer either from human log text. They require the producer
extensions described in Slice B.

## Slice A — Surface the response that exists

**Status: implemented.** `apps/web/src/results.ts` holds the pure helpers,
`apps/web/src/RunView.tsx` the terminal view, and
`apps/web/test/results.test.ts` plus `apps/web/test/runView.test.tsx` the
tests. The build, unit, and Playwright gates below all pass.

One adapter change came out of it: `failureFor` had been quoting the last
stderr line verbatim, which on a glog-wrapped error is a bare `>`
continuation. Those continuation lines are now skipped, so a failed run shows
the producer's actual message. That remains passing the message through, not
classifying it.

This slice is entirely local to `neuriplo-ui` and is the first implementation
target.

### A1. Extract presentation helpers

Add a small task-neutral result module under `apps/web/src/` containing pure
functions for:

- formatting durations with stable units;
- quoting one POSIX shell argument and joining `command.bin` plus
  `command.args` into a reproducible command;
- formatting unknown JSON without changing its values;
- deriving a display summary from exit code, signal, timeout, and artifact
  count.

Quoting must preserve empty arguments, whitespace, quotes, dollar signs,
backticks, and newlines. It must never rebuild the command from the form; the
server response is authoritative because it contains the exact spawned
arguments.

Add focused unit tests in `apps/web/test/` for ordinary arguments and each
shell-sensitive boundary.

### A2. Build the terminal run header

Replace the current single summary line with a compact header that shows:

- `Succeeded`, `Failed`, or `Rejected`;
- task and model;
- execution workflow plus backend or protocol/transport;
- adapter-observed wall time;
- exit code, signal, and timeout state where applicable;
- run id as a diagnostic identifier.

Keep adapter rejection separate from a pipeline that started and failed. A
rejected request has no process command, duration, or exit code and must not be
presented as if `neuriplo-infer` ran.

### A3. Render structured results generically

When `run.result` is non-null, show it in a `Structured result` section as
formatted JSON. The renderer must support objects, arrays, scalars, empty
objects, and empty arrays without assuming a task-specific schema.

When `run.result` is null, omit the section and leave artifacts and logs
available. Do not show an error or synthesize predictions from stdout.

Task-specific result cards or tables are deferred until `neuriplo-infer`
publishes a versioned result schema or a discriminator that makes those views
stable.

### A4. Add reproducible command controls

Show the exact command in a horizontally scrollable code block. Add a `Copy
command` button using `navigator.clipboard.writeText`, with a short-lived
`Copied` confirmation and an accessible status announcement.

If the clipboard API rejects the write, keep the command visible and show a
non-destructive error message so it can still be selected manually. Never
execute the command from the browser.

### A5. Add collapsible logs

Add a `Logs` section containing separate stdout and stderr `<details>` blocks.
Preserve whitespace, wrap long lines without destroying copyability, and show
the existing truncation marker unchanged. Empty streams should say `No output`
rather than rendering a blank panel.

Both streams remain collapsed after success. On a failed run, stderr opens by
default so the primary diagnostic is visible without hiding stdout.

### A6. Preserve and integrate artifacts

Keep the existing safe artifact URLs and inline image/video previews. Move them
under an explicit `Artifacts` heading and format byte sizes consistently with
the existing file-browser helper.

Artifact rendering must remain independent from `run.result`: a run may have
either, both, or neither.

### A7. Verify Slice A

Add component-level or pure presentation tests that cover:

- success with structured JSON, logs, command, duration, and artifacts;
- success with a null structured result and a rendered artifact;
- non-zero exit with stderr opened and the exact producer message shown;
- timeout and signal termination summaries;
- request rejection remaining distinct from a completed failed run;
- command copying success and clipboard failure;
- shell quoting for empty and hostile-looking arguments;
- empty and truncated log streams.

Extend the Playwright path to assert the command, wall-time label, log controls,
and structured result when those fields are present. The real-machine E2E test
may still accept either a successful or failed terminal state; deterministic
success semantics belong to Phase 5.

Slice A gates:

```bash
npm run build
npm test
npm run test:e2e
```

The E2E gate requires a configured `NEURIPLO_INFER_BIN` and the same runtime
fixtures already required by the existing test.

## Slice B — Extend the producer diagnostics contract

**Status: implemented,** in `neuriplo-infer` first and then here.

The producer publishes `app/inc/RunReport.hpp` / `app/src/RunReport.cpp`,
writing `data/output/run_report.json` for every run and advertising it under
`diagnostics.run_report` in `--capabilities` (covered by
`docs/capabilities.schema.json`, `test_RunReport.cpp`, `test_RunDiagnostics.cpp`,
and a new `capabilities_schema_contract` test). On this side,
`apps/server/src/runReport.ts` reads and validates it, `runResponse.ts` carries
`metrics` and `error.stage`, and `RunView.tsx` renders both.

The shape below is what shipped, with two deviations worth recording. The
report is a file in the run directory rather than a field on stdout, because
stdout already carries a task's own JSON result and a second document there
would break the existing parse. And the adapter discovers the file through the
capabilities contract instead of a well-known name, so the frontend and adapter
still hold no producer knowledge.

This slice starts in `neuriplo-infer`; `neuriplo-ui` only consumes the resulting
fields. The schema must be versioned and covered by producer contract tests
before the UI depends on it.

### B1. Define task-neutral metrics

Extend the run output with an optional metrics envelope whose units and timing
boundaries are explicit. A suitable shape is:

```json
{
  "metrics": {
    "wall_time_ms": 123.4,
    "samples": 1,
    "frames": null,
    "throughput_per_second": null,
    "stages_ms": {
      "model_load": 40.1,
      "preprocess": 2.3,
      "inference": 10.4,
      "postprocess": 1.8,
      "render": 3.0
    }
  }
}
```

The final field names may follow the producer's schema conventions, but the
contract must define whether a value is per-run, a sum, a mean, or a percentile.
Unknown or unmeasured values stay absent or null. The UI must not derive FPS
unless the contract supplies both a compatible processed-count boundary and
elapsed-time boundary.

For repeated benchmark runs, publish count plus summary statistics rather than
only the final observation. Percentile calculation and local/remote comparison
remain Phase 6 behavior, but Phase 4 should be able to render the values.

### B2. Define typed failure stages

Extend failed producer output with a stable stage enum, initially:

```text
configuration
model_load
source
preprocess
inference
postprocess
render
unknown
```

Keep the human message and native exit information. The adapter should pass the
producer stage through rather than classify stderr. Adapter-owned failures
remain separate (`rejected`, `timeout`, `terminated`, `spawn_failed`).

If the producer cannot attribute a failure, return `unknown`; do not guess.

### B3. Consume the extensions

After producer schema tests pass:

- update the server and web run types;
- validate the optional envelope at the adapter boundary;
- show wall time and per-stage values as different metrics;
- show FPS or throughput only when explicitly supplied;
- map the typed failure stage to a visible label while retaining the original
  error code and message;
- add adapter tests for present, absent, partial, and unknown-stage envelopes;
- add web tests proving that missing metrics do not produce zeros or misleading
  labels.

## Slice C — Documentation and acceptance

Update `README.md` and `specs/roadmap.md` after the corresponding gates pass.
Screenshots are refreshed only after the terminal result layout is stable.

Phase 4 acceptance requires:

1. The exact command shown by the UI round-trips to the server-provided binary
   and argument array under the documented POSIX-shell assumption.
2. Success, rejection, timeout, termination, and producer failure are visually
   distinct and accessible by text, not color alone.
3. Structured JSON is displayed without a task registry in the frontend.
4. Stdout and stderr remain available for every completed run.
5. Wall time is never presented as inference latency.
6. Per-stage metrics and failure categories appear only when backed by the
   versioned producer contract.
7. Existing artifact path-confinement tests continue to pass.
8. Build, unit tests, and the configured Playwright path pass.

## Explicitly deferred

- Task-specific prediction tables, charts, and overlays without a versioned
  producer result schema.
- Parsing glog text, FPS overlays, timing CSV files, or artifact names to infer
  metrics or failure stages.
- Run history, cancellation, streaming logs, and concurrent runs.
- Local-versus-remote comparisons and benchmark aggregation UI (Phase 6).
- Deterministic multi-task browser fixtures and CI orchestration (Phase 5).
