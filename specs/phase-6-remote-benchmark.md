# Phase 6 — Remote inference and benchmark workflows

## Outcome

Phases 1–5 make one run configurable, reproducible, diagnosable, and tested.
Phase 6 makes runs *comparable*: against each other, against a remote server,
and against repetition.

Phase 6 is complete when the UI can:

- report what a remote KServe server actually is, from the server rather than
  from the form that addressed it;
- retain more than one finished run and return to any of them;
- run the same configuration repeatedly and summarize what was measured;
- put two or more runs side by side — local against remote, backend against
  backend, model against model — showing what differed and what did not.

## What is already delivered

The first roadmap item, *expose client-server endpoint/model/version/transport
configuration*, landed in Phase 3. The configurator renders protocol and
transport controls from the contract, pairs a protocol's advertised transports
with the parameter that becomes the CLI flag, and shows those controls only for
the client-server workflow. Phase 6 does not revisit it beyond checking the box.

Two other pieces are already in place and are the foundation for this phase: a
run response that carries producer-measured metrics separately from
adapter-observed wall time (Phase 4), and a harness that can drive a full run
from the browser without a machine (Phase 5).

## The two dependencies, named up front

**A remote server.** Nothing in this repository can prove the server half of
client-server execution, which is why Phase 5 left that item open. The data
plane lives in `neuriplo-kserve-runtime`, which advertises a stub executor —
raw tensor inference with no model — and that is exactly the deterministic
remote runtime the matrix needs. It is a C++ build in another repository,
so Slice E treats it as an optional dependency: the suite uses it when a
runtime is configured, and a fixture remote otherwise.

**Benchmark statistics inside one run.** `--capabilities` advertises
`benchmark` and `iterations`, but the run report publishes a single
observation: `wall_time_ms`, `samples`, `frames`, `throughput_per_second`, and
per-stage sums. Nothing in it carries per-iteration values, so no percentile,
spread, or confidence interval for a `--benchmark` run can be computed here
without inventing it. That is a producer extension, exactly like Phase 4's
Slice B, and it is **not** attempted in this phase.

What *can* be done honestly is the other kind of repetition: the UI launches
the same configuration N times and aggregates what each of those N runs
reported. Every input to that summary is a measurement someone took. The
distinction is load-bearing and must survive into the UI's labels — a summary
over N runs is not a benchmark of one run's iterations, and must never be
presented as one.

## Slice A — Run history

Comparison, repetition, and the remote/local question all need the same thing
first: more than one run alive at a time.

### A1. Retain finished runs

Keep completed runs in a session-scoped list, newest first, and let the panel
show any of them. A rejected request is not a run and is not retained: it never
reached the binary and has nothing to compare.

History lives in the browser only. The adapter persists nothing, and a reload
starts empty — retaining it would mean inventing a storage contract, and the
artifacts a retained run points at live in run directories the adapter is free
to clean. A retained run whose artifacts have been removed still shows its
command, metrics, and logs; only the images stop resolving, which is the honest
outcome and not a broken state to hide.

Cap the list, and drop the oldest beyond the cap, because a run carries its
whole stdout and stderr and an unbounded list is an unbounded page.

### A2. Show the history

A compact list: status, task, model, execution, wall time, and how long ago.
Selecting an entry shows that run in the existing panel unchanged — history
changes which run is displayed, never what a run means.

The newest run is selected automatically when it arrives, so the common case
is exactly what it is today.

### A3. Verify Slice A

Unit tests for the retention rules — ordering, the cap, rejection not being
retained — and a browser test that runs twice and returns to the first.

## Slice B — Remote server metadata

### B1. Ask the server what it is

Add `GET /api/remote/metadata` to the adapter, taking the endpoint the user
configured and returning the KServe V2 server and model metadata: server name
and version, model name, versions, platform, and the inputs and outputs it
declares.

This is the first time the adapter fetches a URL supplied by the browser, and
that is a server-side request forgery surface: the adapter sits on the
operator's machine and can reach hosts the browser cannot. It must therefore be
confined the way source paths already are — `NEURIPLO_UI_REMOTE_ALLOW` names
the hosts an endpoint may address, an endpoint outside it is refused before any
connection is opened, and the refusal names the variable rather than leaking
what was reachable. The request carries a short timeout and a bounded response
size, and the adapter never follows a redirect to a host the allowlist would
have refused.

### B2. Show what came back

Render the server's own answer beside the client-server controls: platform,
versions, and declared tensors. A server that cannot be reached says so without
blocking the run — the endpoint is still valid input, and the run is still the
authority on whether it works.

Nothing here changes what the UI knows: the metadata is displayed, never used
to narrow a selection, because the contract that governs selection is
`neuriplo-infer`'s.

## Slice C — Repeated runs and summary statistics

**Status: implemented.** `apps/web/src/summary.ts` holds the aggregation,
rendered under the comparison in `CompareView.tsx`, with unit tests in
`apps/web/test/summary.test.ts` and a browser path that repeats a
configuration three times.

### C1. Repeat a configuration

Let the user run the same configuration N times. Runs execute one after
another, not concurrently — concurrency would contend for the same device and
make every number meaningless.

Each repetition is an ordinary run: its own directory, its own report, its own
history entry. Nothing about a single run changes because it was one of N.

### C2. Summarize only what was measured

Aggregate across the N runs: count, minimum, median, and maximum of adapter
wall time, and of each producer measurement that all N supplied. A statistic
the sample cannot support is not shown — no p95 over five runs — and a
measurement that some runs lack is summarized over the runs that have it, with
the count that produced it stated.

The summary must name itself accurately: *N runs*, not iterations, and not a
benchmark of the producer's own loop.

## Slice D — Comparison

**Status: implemented.** `apps/web/src/compare.ts` holds the difference rules
and `apps/web/src/CompareView.tsx` the table, with unit tests in
`apps/web/test/compare.test.ts` and `compareView.test.tsx` and a browser path
that compares a local run against a client-server one.

### D1. Compare retained runs

Select two or more runs from the history and show them side by side: status,
execution, wall time, producer metrics, and the artifacts each produced. What
differed between them is what the view exists to show, so the differing fields
are marked and the identical ones stay quiet.

Local against remote is the motivating case and needs no special support: they
are two runs with different executions. Backend against backend and model
against model fall out of the same view, which is the fifth roadmap item.

### D2. Do not conclude

The view shows measurements side by side. It does not declare a winner,
compute a speedup, or normalize across machines: two runs on different
executions differ in ways the numbers alone do not explain, and asserting
otherwise would be the same mistake as calling wall time inference latency.

## Slice E — Tests and the deterministic remote

Extend the fixture producer so a client-server run is distinguishable from a
local one, and add a fixture remote — a small KServe V2 responder — so the
metadata path is exercised without a network. Where
`neuriplo-kserve-runtime` is configured, point the same tests at it and close
the Phase 5 item that has been waiting for it.

Assert: history retention and selection, metadata rendering including the
refusal path, an N-run summary over known values, and a comparison marking the
fields that differ.

## Slice F — Documentation and acceptance

Phase 6 acceptance requires:

1. Remote metadata comes from the server and is refused for a host outside the
   allowlist.
2. History retains runs, bounded, and never retains a rejection.
3. An N-run summary is computed only from measurements the runs reported, and
   is labelled as a summary over runs rather than over a producer's iterations.
4. A comparison marks what differed without concluding anything from it.
5. No statistic appears that the sample size does not support.
6. Build, unit tests, and the Playwright matrix pass in both producer modes.

## Explicitly deferred

- Per-iteration statistics inside one `--benchmark` run: a producer contract
  extension, not a UI feature.
- Persisting history or artifacts across a reload.
- Concurrent runs, cancellation, and streaming logs.
- Declaring one execution faster than another, or any cross-machine
  normalization.
