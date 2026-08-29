# Phase 5 — Real E2E matrix

## Outcome

Neuriplo UI must become a regression harness rather than a manual frontend with
a smoke test attached. Phase 5 is complete when a single command starts the web
app and the adapter, runs a browser-driven matrix against a deterministic
producer, and fails when the pipeline's *meaning* changes — not only when a
request returns a non-2xx status.

Phase 5 is complete when:

- `npm run test:e2e` starts and stops everything it needs, on a machine that has
  no models, no weights, and no compiled `neuriplo-infer`;
- the same suite runs unchanged against a real `neuriplo-infer` when one is
  configured;
- one pipeline per structural task family is exercised through the browser;
- a successful run is asserted by its artifacts, its structured result, and its
  producer metrics, not by a terminal state;
- a failing run is asserted by its typed stage, exit code, and stderr;
- a failed test leaves a trace, a screenshot, and both server logs behind.

## Current boundary

`e2e/tests/pipeline.spec.ts` already asserts against the shape of the
capabilities contract rather than against specific tasks, which is the property
worth keeping. Everything else about the harness is manual:

- `playwright.config.ts` declares no `webServer`, so the operator has to run
  `npm run dev` in another terminal first;
- the suite requires `NEURIPLO_INFER_BIN` to point at a real binary, plus real
  weights and real source files on the same machine;
- the terminal-state assertion is `/Succeeded|Failed|Rejected/`, because on an
  arbitrary machine no stronger claim is true;
- `trace` is `on-first-retry` and no retries are configured, so a failure in CI
  would leave nothing behind.

The blocker is the producer, not the tests. A real run needs weights measured in
hundreds of megabytes and a backend compiled into the binary; a CI runner has
neither, and a developer machine has whichever ones happen to be there. Nothing
stronger than "it reached a terminal state" can be asserted against a producer
whose availability is unknown.

## The determinism problem

The obvious fix — assert against a known model on a known image — trades one
unavailable dependency for another. Phase 5 instead separates the two things the
suite actually tests:

1. **The contract path.** Capabilities reach the browser, the configurator
   renders from them, a request is validated against them, a command is spawned
   from them, and a response is rendered from it. None of this depends on
   inference being real.
2. **The inference itself.** Which is `neuriplo-infer`'s own test suite's job,
   and is not re-tested here.

So the harness supplies a **fixture producer**: an executable that implements
the published capabilities and run-report contracts and whose output is a pure
function of its arguments. It renders nothing and infers nothing. It is a
contract double, not a second implementation, and the distinction is what keeps
it honest:

- it may advertise a contract and produce a response;
- it may not encode any behavior the UI is allowed to know about, because the
  UI is not allowed to know any.

Two rules keep it from becoming a private second source of truth:

- its `--capabilities` output is validated by `discoverCapabilities` — the same
  validator a real binary passes — in a unit test, so a contract change that
  breaks the real producer breaks the fixture too;
- every assertion in the suite is derived from the response or the contract at
  runtime, so the suite runs unchanged against a real binary. A test that needs
  values only the fixture can guarantee guards on the advertised producer
  version rather than being written twice.

The fixture advertises `producer.version` suffixed `-fixture`. That is the only
way anything distinguishes the two, and it is deliberately visible in the UI.

## Slice A — Start the harness and make it deterministic

**Status: implemented.** `e2e/fixtures/producer/` holds the fixture,
`e2e/fixtures/assets/` its inputs, and `e2e/playwright.config.ts` starts both
apps. The existing suite passed unchanged against the fixture and against a
real binary, which is what this slice was aiming at.

The suite must start what it tests and stop needing a machine.

### A1. Add the fixture producer

Add `e2e/fixtures/producer/neuriplo-infer-fixture.mjs`, an executable Node
script implementing the CLI surface the adapter actually uses:

- `--capabilities` prints a capabilities document with
  `schema_version` 2, a `producer.version` ending in `-fixture`, and a
  `diagnostics.run_report` section;
- a run parses `--type=`, `--source=`, and the advertised parameter flags from
  the argument array, writes its artifacts relative to the current directory,
  writes the advertised run report, and exits.

The advertised contract must be structurally complete rather than large: it
carries one task per structural family the UI branches on, and nothing else.

| Family | Exercises |
| --- | --- |
| single-source image task, JSON output | structured result, artifact, metrics |
| multi-source task (`min_items` 2, unbounded) | source slot generation |
| video task | a non-image artifact and frame counts |
| prompt-driven task | a required string parameter |
| client-server-only workflow | endpoint/protocol/transport controls |

A run's outcome is decided by its source, so no flag outside the contract is
invented to steer it: a source whose basename starts with `fail-<stage>` fails
in that stage, writing a report whose `error.stage` is `<stage>` and exiting
non-zero with a message on stderr. Every other source succeeds.

### A2. Add fixture assets

Add `e2e/fixtures/assets/` with committed, deterministic files: a small PNG, a
placeholder video file, and the `fail-<stage>` sources the failure cases need.
They are bytes on disk, which is all the adapter checks and all the fixture
producer reads.

Real sources for a real producer stay the operator's, and the suite must say so
rather than pretending a committed placeholder decodes.

### A3. Start web and server from the configuration

Add `webServer` entries to `e2e/playwright.config.ts` that build both apps and
start the adapter and a `vite preview` of the built frontend, with
`reuseExistingServer` so an operator who already has `npm run dev` running keeps
using it. `NEURIPLO_INFER_BIN` defaults to the fixture producer and is never
overridden when the operator set one.

Preview needs the same `/api` proxy the dev server has; add it to
`apps/web/vite.config.ts`.

### A4. Retain diagnostics on failure

Set `trace`, `screenshot`, and `video` to retain on failure, write both
servers' output to files, and keep the HTML report. A failing CI run must be
diagnosable from its artifacts alone — and Playwright's own `stdout: "pipe"`
only forwards to the runner's terminal, so each server's output is also teed to
`e2e/test-results/<name>.log`, which is outside the directory Playwright cleans
and inside the one CI uploads.

### A5. Keep the harness off the network

The harness serves a page that proxies to an adapter that spawns binaries and
turns any source path it is given into an artifact the browser can fetch. Both
servers therefore bind `127.0.0.1` — `vite preview` is invoked directly rather
than through the workspace script, which binds `0.0.0.0` — and the adapter runs
with `NEURIPLO_UI_SOURCE_ROOT` set to the browse root, so a source outside it is
refused rather than copied out.

### A6. Verify Slice A

The existing suite passes unchanged against the fixture producer. That is the
acceptance criterion for the slice: the tests were written against the contract,
so a contract-complete fixture must satisfy them without an edit. Add the
`discoverCapabilities` contract test from the determinism rules above.

Slice A gates:

```bash
npm run build
npm test
npm run test:e2e
NEURIPLO_INFER_BIN=/path/to/neuriplo-infer npm run test:e2e
```

## Slice B — Assert semantics, not terminal states

**Status: implemented** in `e2e/tests/runs.spec.ts`, with the contract-driven
driver in `e2e/tests/support/harness.ts`. The run test that only checked for a
terminal state moved out of `pipeline.spec.ts`, which is now the configurator's
suite alone.

With a deterministic producer, the suite can assert what a run *meant*.

### B1. Assert a successful run's substance

For a successful run, assert that:

- the rendered artifact is served, decodes in the browser, and matches the
  bytes the producer wrote;
- the structured result is displayed with the values the response carried,
  rather than merely being present;
- producer metrics render the stages the report measured and omit the ones it
  did not;
- adapter wall time and producer wall time appear as two different numbers.

### B2. Assert a failed run's diagnosis

Drive a `fail-<stage>` source through the browser and assert that the UI shows
the producer's stage, the exit code, and the stderr message, with stderr opened,
and that no artifact or structured-result section claims a success.

### B3. Walk the task-family matrix

Iterate the advertised tasks, select one representative per structural family,
and run each through the browser. The representative is chosen from the contract
at runtime, so a real producer exercises its own families and the fixture
exercises the five above.

Assert artifact creation for every family and structured results for the
families that advertise `output_format`.

Against a real producer the committed placeholders cannot succeed, and
accepting any failure would keep the suite green against a binary that rejects
every command line. A run must therefore fail *past configuration*, in a stage
the producer attributes to the inputs it was handed. Real inputs supplied
through `NEURIPLO_UI_E2E_IMAGE`, `NEURIPLO_UI_E2E_VIDEO`, and
`NEURIPLO_UI_E2E_WEIGHTS` turn the same tests back into success assertions.

Slice B gates: as Slice A, plus the matrix passing against the fixture.

## Slice C — Execution coverage

**Status: implemented, one half deferred.** Backend switching runs each
advertised backend and skips with its reason where a build advertises one.
Client-server execution runs against the fixture's workflow; the deterministic
remote runtime it would need to prove the server's half is Phase 6's.

- **Local backend switching.** Only meaningful where a build advertises more
  than one backend. The suite selects each advertised backend in turn and
  asserts the run reaches its terminal state; where a build advertises one, the
  test skips with that reason stated, exactly as the existing suite does.
- **Client-server execution.** Runs against the fixture's client-server
  workflow, which validates the endpoint/protocol/transport path end to end
  without a network dependency. A deterministic remote runtime is Phase 6's
  concern; this asserts the UI and adapter halves.

## Slice D — CI

**Status: implemented** in `.github/workflows/ci.yml`.

Wire the gates into GitHub Actions once they are green locally: install, build,
unit tests, then Playwright with the fixture producer, uploading the report and
traces on failure. Phase 7 owns linting, formatting, and packaging; this slice
only runs what Phase 5 defines.

## Slice E — Documentation and acceptance

**Status: implemented.**

Update `README.md` and `specs/roadmap.md` after the gates pass.

Phase 5 acceptance requires:

1. `npm run test:e2e` passes on a machine with no `neuriplo-infer`.
2. The same command passes against a real binary when one is configured, with
   fixture-specific assertions skipped by advertised version rather than by
   editing the suite.
3. One pipeline per structural task family runs through the browser.
4. A successful run is asserted by artifact, structured result, and metrics.
5. A failed run is asserted by producer stage, exit code, and stderr.
6. No test asserts a task-specific fact the frontend is not allowed to know.
7. A failure leaves a trace, a screenshot, and both server logs as files.
8. Neither server is reachable off the loopback interface, and no run can read
   a file outside the configured source root.

## Explicitly deferred

- Real weights, real models, and real inference output in CI: that is the
  producer's own test suite.
- Visual regression or pixel comparison of rendered predictions.
- A deterministic remote inference runtime and local-versus-remote comparison
  (Phase 6).
- Benchmark aggregation and summary statistics (Phase 6).
- Linting, formatting, container images, and release packaging (Phase 7).
