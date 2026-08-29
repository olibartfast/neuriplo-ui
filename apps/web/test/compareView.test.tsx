// tsx compiles this file with the classic JSX runtime, so React stays in scope.

import assert from "node:assert/strict";
import { test } from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ComparePanel } from "../src/CompareView.js";
import type { RunResult } from "../src/run.js";

function run(overrides: Partial<RunResult> = {}): RunResult {
  return {
    status: "success",
    run_id: "0f7c1d2e-0000-4000-8000-000000000001",
    task: "object_detection",
    model: "yolo26",
    execution: {
      workflow: "local",
      backend: "onnx_runtime",
      protocol: null,
      transport: null,
    },
    source: { type: "image", paths: ["/tmp/fixture.png"] },
    command: { bin: "/opt/neuriplo-infer", args: [] },
    exit_code: 0,
    signal: null,
    timed_out: false,
    duration_ms: 1200,
    artifacts: [],
    result: null,
    metrics: null,
    stdout: "",
    stderr: "",
    error: null,
    ...overrides,
  };
}

test("shows nothing until two runs are chosen", () => {
  assert.equal(renderToStaticMarkup(<ComparePanel runs={[]} />), "");
  assert.equal(renderToStaticMarkup(<ComparePanel runs={[run()]} />), "");
});

test("puts the runs side by side and marks the rows that differ", () => {
  const markup = renderToStaticMarkup(
    <ComparePanel
      runs={[
        run({ run_id: "aaaaaaaa-0000-4000-8000-000000000001" }),
        run({
          run_id: "bbbbbbbb-0000-4000-8000-000000000002",
          duration_ms: 2400,
          execution: {
            workflow: "client_server",
            backend: null,
            protocol: "kserve_v2",
            transport: "http",
          },
        }),
      ]}
    />,
  );

  assert.match(markup, /data-testid="comparison"/);
  assert.match(markup, /2 runs differing in execution/);

  // A difference is carried by text as well as by style, never by colour
  // alone.
  assert.match(markup, /data-differs="true"/);
  assert.match(markup, /· differs/);

  const wallTime = markup.slice(
    markup.indexOf('data-testid="comparison-row-wall-time-whole-process"'),
  );
  assert.match(wallTime.slice(0, 400), /data-differs="true"/);

  const model = markup.slice(
    markup.indexOf('data-testid="comparison-row-model"'),
  );
  assert.match(model.slice(0, 400), /data-differs="false"/);
});

test("renders an absent measurement as a dash rather than a zero", () => {
  const markup = renderToStaticMarkup(
    <ComparePanel
      runs={[
        run({
          run_id: "aaaaaaaa-0000-4000-8000-000000000001",
          metrics: {
            wall_time_ms: 56.5,
            samples: 1,
            frames: null,
            throughput_per_second: null,
            stages_ms: {
              model_load: 40,
              preprocess: null,
              inference: 10,
              postprocess: null,
              render: null,
            },
          },
        }),
        run({ run_id: "bbbbbbbb-0000-4000-8000-000000000002" }),
      ]}
    />,
  );

  assert.match(markup, /—/);
  assert.doesNotMatch(markup, />0 ms</);
  // A stage neither run measured gets no row at all.
  assert.doesNotMatch(markup, /comparison-row-postprocess/);
});

test("draws no conclusion from the numbers it shows", () => {
  const markup = renderToStaticMarkup(
    <ComparePanel
      runs={[
        run({ run_id: "aaaaaaaa-0000-4000-8000-000000000001" }),
        run({
          run_id: "bbbbbbbb-0000-4000-8000-000000000002",
          duration_ms: 9000,
        }),
      ]}
    />,
  );

  // The table itself states measurements and nothing else; the only mention
  // of "faster" anywhere is the disclaimer saying it will not say it.
  const table = markup.slice(
    markup.indexOf("<table"),
    markup.indexOf("</table>"),
  );
  assert.doesNotMatch(table, /faster|slower|winner|speedup|improvement/i);
  assert.match(markup, /no run is called faster than another/i);
});
