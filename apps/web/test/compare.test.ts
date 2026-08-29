import assert from "node:assert/strict";
import { test } from "node:test";
import {
  compareRuns,
  describeComparison,
  sameConfiguration,
} from "../src/compare.js";
import type { RunMetrics, RunResult } from "../src/run.js";

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

function rowFor(rows: ReturnType<typeof compareRuns>, label: string) {
  return rows.find((row) => row.label === label);
}

test("compares nothing until there are two runs", () => {
  assert.deepEqual(compareRuns([]), []);
  assert.deepEqual(compareRuns([run()]), []);
});

test("marks what differed and leaves what matched quiet", () => {
  const rows = compareRuns([
    run({ run_id: "a", duration_ms: 1200 }),
    run({ run_id: "b", duration_ms: 2400 }),
  ]);

  assert.equal(rowFor(rows, "Wall time (whole process)")?.differs, true);
  assert.equal(rowFor(rows, "Model")?.differs, false);
  assert.equal(rowFor(rows, "Execution")?.differs, false);
});

test("decides difference on the raw value, not the formatted one", () => {
  // Both format as "1.20 s", so comparing display strings would call these
  // identical when they are not.
  const rows = compareRuns([
    run({ run_id: "a", duration_ms: 1200.1 }),
    run({ run_id: "b", duration_ms: 1200.4 }),
  ]);

  const row = rowFor(rows, "Wall time (whole process)");
  assert.equal(row?.differs, true);
  assert.equal(row?.cells[0].text, row?.cells[1].text);
});

test("keeps a measurement one run took and the other did not", () => {
  const rows = compareRuns([
    run({ run_id: "a", metrics: metrics() }),
    run({ run_id: "b", metrics: null }),
  ]);

  const row = rowFor(rows, "Producer wall time");
  // An absence is itself the difference, so the row stays and is marked.
  assert.equal(row?.differs, true);
  assert.equal(row?.cells[1].absent, true);
  assert.equal(row?.cells[1].text, "—");
});

test("drops a measurement no run took", () => {
  const rows = compareRuns([run(), run({ run_id: "b" })]);

  // Neither run published a report, so there is no producer row to show: a
  // measurement nobody took is not a similarity worth a line.
  assert.equal(rowFor(rows, "Producer wall time"), undefined);
  assert.equal(rowFor(rows, "Inference"), undefined);
  assert.equal(rowFor(rows, "Frames"), undefined);
  // What the adapter always measures is still there.
  assert.ok(rowFor(rows, "Wall time (whole process)"));
});

test("shows a failure stage only when a run reported one", () => {
  const rows = compareRuns([
    run({
      run_id: "a",
      status: "failed",
      exit_code: 1,
      error: { code: "run_failed", message: "boom", stage: "inference" },
    }),
    run({ run_id: "b" }),
  ]);

  const row = rowFor(rows, "Failure stage");
  assert.equal(row?.cells[0].text, "Inference");
  assert.equal(row?.cells[1].text, "—");
  assert.equal(rowFor(rows, "Status")?.differs, true);
});

test("does not call different invocations the same configuration", () => {
  const base = run({
    run_id: "a",
    command: { bin: "/opt/x", args: ["--type=yolo26", "--source=/a.png"] },
  });
  const otherSource = run({
    run_id: "b",
    command: { bin: "/opt/x", args: ["--type=yolo26", "--source=/b.png"] },
  });

  // Same task, model, and execution, but a different source: statistics over
  // the pair would describe no single thing.
  assert.equal(sameConfiguration([base, otherSource]), false);
  assert.equal(
    describeComparison([base, otherSource]),
    "2 runs differing in arguments.",
  );

  const otherThreshold = run({
    run_id: "c",
    command: {
      bin: "/opt/x",
      args: ["--type=yolo26", "--min_confidence=0.9", "--source=/a.png"],
    },
  });
  assert.equal(sameConfiguration([base, otherThreshold]), false);
});

test("names a transport that differs, which only the execution carries", () => {
  const http = run({
    run_id: "a",
    execution: {
      workflow: "client_server",
      backend: null,
      protocol: "kserve_v2",
      transport: "http",
    },
  });
  const grpc = run({
    run_id: "b",
    execution: {
      workflow: "client_server",
      backend: null,
      protocol: "kserve_v2",
      transport: "grpc",
    },
  });

  // Both are client-server against the same protocol, so a caption looking
  // only at the workflow would call these identical while the Execution row
  // says otherwise.
  assert.equal(
    describeComparison([http, grpc]),
    "2 runs differing in execution.",
  );
  assert.equal(rowFor(compareRuns([http, grpc]), "Execution")?.differs, true);
});

test("names a task that differs", () => {
  assert.equal(
    describeComparison([
      run({ run_id: "a" }),
      run({ run_id: "b", task: "classification" }),
    ]),
    "2 runs differing in task.",
  );
});

test("names what varies without interpreting it", () => {
  const local = run({ run_id: "a" });
  const remote = run({
    run_id: "b",
    execution: {
      workflow: "client_server",
      backend: null,
      protocol: "kserve_v2",
      transport: "http",
    },
  });

  assert.equal(
    describeComparison([local, remote]),
    "2 runs differing in execution.",
  );
  assert.equal(
    describeComparison([local, run({ run_id: "c", model: "rtdetr" })]),
    "2 runs differing in model.",
  );
  assert.equal(
    describeComparison([local, run({ run_id: "c" })]),
    "2 runs of the same configuration.",
  );

  // No speedup, no winner, no verdict anywhere in the caption.
  const captions = [
    describeComparison([local, remote]),
    describeComparison([local, run({ run_id: "c" })]),
  ];
  for (const caption of captions) {
    assert.doesNotMatch(caption, /faster|slower|better|worse|speedup|×/i);
  }
});
