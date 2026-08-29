# Phase 7 — Packaging and CI integration

## Outcome

Phases 1–6 built the thing. Phase 7 is about keeping it built: the gates that
run before a change lands, and the decisions about how this repository is
consumed by anyone who is not already sitting in it.

Phase 7 is complete when:

- every line of TypeScript in the repository is type-checked by a gate, not
  just the lines that happen to be compiled;
- one tool formats and lints the whole repository, and CI fails when it would
  change something;
- the modules that only the browser suite was exercising have unit tests of
  their own;
- CI runs those gates in a shape that reports a style failure in seconds rather
  than behind a browser matrix;
- the Docker/dev-container and release-packaging questions are answered with a
  reason, not left open.

## The hole this phase actually closes

The E2E harness is the thing that proves everything else works, and it is the
only code in the repository that nothing checks. Playwright runs TypeScript
through esbuild, which strips types without ever verifying them, and `e2e/` has
no `tsconfig.json` at all. The adapter's tests are in the same position for a
different reason: `apps/server/tsconfig.json` includes `src/**/*.ts` only, so
`npm run build` compiles the server and never looks at the suite that tests it,
and `node --import tsx` strips types at runtime the same way esbuild does.

That is 3,209 lines — the harness, its fixtures, its Playwright configuration,
and every adapter test — roughly a third of the repository's TypeScript, none
of it type-checked by anything. A test file that drifts out of shape with the
module it tests still runs; it just fails later, or worse, passes while
asserting against a type that no longer exists.

Nothing here is a new capability. It is the gate that should have existed since
Phase 0, and it goes first because the later slices edit that same code.

## Slice A — Type-check everything

### A1. Give `e2e/` a tsconfig and a typecheck script

Cover `playwright.config.ts` and `tests/**`. The `.mjs` fixtures stay out: they
are plain JavaScript by design, because the fixture producer is an executable
the adapter spawns rather than a module this workspace compiles.

### A2. Extend the server's tsconfig to its tests

The build keeps emitting `src` only. Type checking is separate from emitting,
so the test files are checked without becoming build output.

### A3. One `npm run typecheck` at the root

Every workspace, one command, and it is what CI calls.

### A4. Fix what it finds

Whatever the new gate reports gets fixed rather than suppressed. If a finding
argues for a type being wrong rather than a use being wrong, the type is what
changes.

## Slice B — One formatter and one linter

### B1. Adopt a single tool

Biome, as a single dev dependency at the root, formats and lints TypeScript,
TSX, JSON, and CSS. The alternative — ESLint with typescript-eslint, a React
plugin, Prettier, and the config that stops the two fighting — is roughly ten
packages to do the same job for a repository whose entire runtime dependency
list is Fastify and React.

### B2. Apply the formatter in its own commit

A first format touches nearly every file. It lands alone so that no logic
change is ever reviewed through a whitespace diff.

### B3. Fix lint findings rather than disabling rules

A lint gate whose failures are answered by disabling the rule is a gate that
reports success by construction. A rule that genuinely does not fit this
repository is turned off once, in the config, with the reason written down —
never inline, file by file, to get a build green.

Comment layout is deliberate throughout this repository: the formatter must
reflow code, never prose.

## Slice C — Unit tests for what only the browser was testing

`apps/web/src/contract.ts`, `run.ts`, and `files.ts` are the three modules the
frontend uses to talk to the adapter, and all three carry the same untested
logic: mapping a failed response into an error the UI can show, and falling
back when the response carries no usable body at all. The browser suite covers
the happy path of each and none of the failure mapping.

What stays untested, deliberately: `App.tsx` is state wiring whose behaviour is
asserted through the browser, where it is real. Testing it in isolation would
mean asserting against a re-implementation of the thing under test.

## Slice D — Run the gates in CI

Style and type gates go in a job of their own, running in parallel with the
build-and-test job. A missing semicolon should not be reported eight minutes
later from behind a browser matrix, and a formatting failure should not stop
the E2E suite from telling us whether the product works.

## Slice E — Bind the dev servers to loopback

`npm run dev` serves on `0.0.0.0`, and the dev server proxies `/api` to an
adapter that browses and reads the developer's filesystem. On any shared
network that is an open door, and it is the same class of finding the Phase 5
harness already fixed for the preview server.

Loopback becomes the default. Exposing the dev server on a network stays
possible, as an explicit opt-in that says what it is.

## Slice F — Answer the two open questions

### F1. Docker / dev-container

The roadmap item is conditional — *if it materially simplifies E2E setup* — so
it needs evidence rather than a preference.

### F2. Release packaging

Decide whether it belongs here or in `neuriplo-platform`, and record the
reasoning where the next person will look for it.

## What this phase does not do

- No coverage threshold. A percentage target rewards testing what is easy to
  reach, and this repository's untested surface is untested for stated reasons.
- No release automation, tags, or published packages, unless F2 concludes that
  packaging belongs here.
- No commit hooks. CI is the gate; a hook is a convenience, and one that
  silently rewrites a developer's commit is not obviously one.
