import assert from "node:assert/strict";
import { test } from "node:test";
import {
  entryFor,
  formatAge,
  HISTORY_LIMIT,
  type HistoryEntry,
  remember,
} from "../src/history.js";
import type { RunResult } from "../src/run.js";

function runWith(runId: string): RunResult {
  return {
    status: "success",
    run_id: runId,
    task: "object_detection",
    model: "yolo26",
    execution: {
      workflow: "local",
      backend: "onnx_runtime",
      protocol: null,
      transport: null,
    },
    source: { type: "image", paths: ["/tmp/fixture.png"] },
    command: { bin: "/opt/neuriplo-infer", args: ["--type=yolo26"] },
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
  };
}

test("keeps the newest run first", () => {
  const history = remember(
    remember([], runWith("first"), 1),
    runWith("second"),
    2,
  );

  assert.deepEqual(
    history.map((entry) => entry.run.run_id),
    ["second", "first"],
  );
  assert.equal(history[0].receivedAt, 2);
});

test("drops the oldest beyond the cap", () => {
  let history: HistoryEntry[] = [];
  for (let index = 0; index < HISTORY_LIMIT + 5; index += 1) {
    history = remember(history, runWith(`run-${index}`), index);
  }

  // A run carries its whole stdout and stderr, so the list has to be bounded.
  assert.equal(history.length, HISTORY_LIMIT);
  assert.equal(history[0].run.run_id, `run-${HISTORY_LIMIT + 4}`);
  assert.equal(history.at(-1)?.run.run_id, "run-5");
});

test("keeps at least the newest run whatever the cap", () => {
  const history = remember([], runWith("only"), 1, 0);
  assert.equal(history.length, 1);
});

test("finds a retained run and reports one that aged out", () => {
  const history = remember([], runWith("kept"), 1);

  assert.equal(entryFor(history, "kept")?.run.run_id, "kept");
  assert.equal(entryFor(history, "gone"), null);
  // Nothing selected is the live run, not a lookup failure.
  assert.equal(entryFor(history, null), null);
});

test("formats age coarsely, because the run's own duration is the number that matters", () => {
  const now = 1_000_000;
  assert.equal(formatAge(now, now), "just now");
  assert.equal(formatAge(now - 3_000, now), "just now");
  assert.equal(formatAge(now - 30_000, now), "30s ago");
  assert.equal(formatAge(now - 120_000, now), "2 min ago");
  assert.equal(formatAge(now - 7_200_000, now), "2 h ago");
  // A clock that stepped backwards must not produce a negative age.
  assert.equal(formatAge(now + 5_000, now), "just now");
});
