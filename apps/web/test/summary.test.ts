import assert from "node:assert/strict";
import { test } from "node:test";
import type { RunMetrics, RunResult } from "../src/run.js";
import { summarize } from "../src/summary.js";

function metrics(overrides: Partial<RunMetrics> = {}): RunMetrics {
  return {
    wall_time_ms: 56.5,
    samples: 1,
    frames: null,
    throughput_per_second: 100,
    stages_ms: {
      model_load: 40,
      preprocess: 2.5,
      inference: 10,
      postprocess: 1.5,
      render: 2.5,
    },
    ...overrides,
  };
}

function run(overrides: Partial<RunResult> = {}): RunResult {
  return {
    status: "success",
    run_id: "run-a",
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
    duration_ms: 1000,
    artifacts: [],
    result: null,
    metrics: null,
    stdout: "",
    stderr: "",
    error: null,
    ...overrides,
  };
}

function rowFor(summary: ReturnType<typeof summarize>, label: string) {
  return summary?.rows.find((row) => row.label === label);
}

test("summarizes nothing below two runs", () => {
  assert.equal(summarize([]), null);
  assert.equal(summarize([run()]), null);
});

test("reports count, minimum, median, and maximum of what was measured", () => {
  const summary = summarize([
    run({ run_id: "a", duration_ms: 1000 }),
    run({ run_id: "b", duration_ms: 3000 }),
    run({ run_id: "c", duration_ms: 2000 }),
  ]);

  const wall = rowFor(summary, "Wall time (whole process)");
  assert.equal(summary?.runs, 3);
  assert.equal(wall?.count, 3);
  assert.equal(wall?.min, "1.00 s");
  assert.equal(wall?.median, "2.00 s");
  assert.equal(wall?.max, "3.00 s");
});

test("takes the midpoint of an even sample", () => {
  const summary = summarize([
    run({ run_id: "a", duration_ms: 1000 }),
    run({ run_id: "b", duration_ms: 2000 }),
  ]);

  assert.equal(rowFor(summary, "Wall time (whole process)")?.median, "1.50 s");
});

test("refuses to aggregate across different configurations", () => {
  // A minimum over two different models describes nothing; comparison is the
  // view for a set like this.
  assert.equal(
    summarize([run({ run_id: "a" }), run({ run_id: "b", model: "rtdetr" })]),
    null,
  );
  assert.equal(
    summarize([
      run({ run_id: "a" }),
      run({
        run_id: "b",
        execution: {
          workflow: "client_server",
          backend: null,
          protocol: "kserve_v2",
          transport: "http",
        },
      }),
    ]),
    null,
  );
  assert.equal(
    summarize([
      run({ run_id: "a" }),
      run({ run_id: "b", task: "classification" }),
    ]),
    null,
  );
});

test("refuses to aggregate runs whose invocation differed", () => {
  const base = run({
    run_id: "a",
    command: { bin: "/opt/x", args: ["--type=yolo26", "--source=/a.png"] },
  });

  // Task, model, and execution all match, so a check on those alone would
  // combine these and label the result "one configuration".
  assert.equal(
    summarize([
      base,
      run({
        run_id: "b",
        command: { bin: "/opt/x", args: ["--type=yolo26", "--source=/b.png"] },
      }),
    ]),
    null,
  );
  assert.equal(
    summarize([
      base,
      run({
        run_id: "c",
        command: {
          bin: "/opt/x",
          args: ["--type=yolo26", "--min_confidence=0.9", "--source=/a.png"],
        },
      }),
    ]),
    null,
  );
});

test("summarizes a producer measurement over the runs that supplied it", () => {
  const summary = summarize([
    run({ run_id: "a", metrics: metrics({ wall_time_ms: 50 }) }),
    run({ run_id: "b", metrics: metrics({ wall_time_ms: 70 }) }),
    run({ run_id: "c", metrics: null }),
  ]);

  const producer = rowFor(summary, "Producer wall time");
  // Two of three runs measured it, and the row says so rather than pretending
  // the third contributed a zero.
  assert.equal(producer?.count, 2);
  assert.equal(producer?.min, "50 ms");
  assert.equal(producer?.max, "70 ms");
  assert.equal(rowFor(summary, "Wall time (whole process)")?.count, 3);
});

test("omits a measurement too few runs supplied", () => {
  const summary = summarize([
    run({ run_id: "a", metrics: metrics() }),
    run({ run_id: "b", metrics: null }),
    run({ run_id: "c", metrics: null }),
  ]);

  // One observation is not a range, so it gets no row rather than a row whose
  // min, median, and max are all the same single number.
  assert.equal(rowFor(summary, "Producer wall time"), undefined);
  assert.ok(rowFor(summary, "Wall time (whole process)"));
});

test("reports no producer rows when no run published a report", () => {
  const summary = summarize([run({ run_id: "a" }), run({ run_id: "b" })]);

  assert.deepEqual(
    summary?.rows.map((row) => row.label),
    ["Wall time (whole process)"],
  );
});
