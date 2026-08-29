// tsx compiles this file with the classic JSX runtime, so React stays in scope.
import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { HistoryPanel } from "../src/HistoryView.js";
import type { HistoryEntry } from "../src/history.js";
import type { RunResult } from "../src/run.js";

const NOW = 1_000_000;

function entry(
  runId: string,
  overrides: Partial<RunResult> = {},
  receivedAt = NOW,
): HistoryEntry {
  return {
    receivedAt,
    run: {
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
    },
  };
}

function render(
  history: HistoryEntry[],
  selectedId: string | null = null,
  comparedIds: string[] = [],
) {
  return renderToStaticMarkup(
    <HistoryPanel
      history={history}
      selectedId={selectedId}
      comparedIds={comparedIds}
      onSelect={() => {}}
      onToggleCompare={() => {}}
      now={NOW}
    />,
  );
}

test("shows nothing until a run has finished", () => {
  assert.equal(render([]), "");
});

test("lists each run with what it was and how it ended", () => {
  const markup = render([
    entry("run-b", { duration_ms: 2500 }, NOW - 60_000),
    entry("run-a"),
  ]);

  assert.match(markup, /data-testid="history-entry-run-b"/);
  assert.match(markup, /data-testid="history-entry-run-a"/);
  assert.match(markup, /Object Detection/);
  assert.match(markup, /yolo26/);
  assert.match(markup, /local · onnx_runtime/);
  assert.match(markup, /2\.50 s/);
  assert.match(markup, /1 min ago/);
});

test("marks the selected run as current", () => {
  const markup = render([entry("run-a"), entry("run-b")], "run-b");

  const selected = markup.slice(markup.indexOf('data-testid="history-entry-run-b"'));
  assert.match(selected.slice(0, 200), /aria-current="true"/);

  const other = markup.slice(markup.indexOf('data-testid="history-entry-run-a"'));
  assert.doesNotMatch(other.slice(0, 200), /aria-current="true"/);
});

test("distinguishes a failed run by text rather than by colour alone", () => {
  const markup = render([entry("run-a", { status: "failed", exit_code: 1 })]);

  assert.match(markup, />Failed</);
  assert.doesNotMatch(markup, />Succeeded</);
});

test("says where history lives, because a reload loses it", () => {
  assert.match(render([entry("run-a")]), /Kept in this page only/);
});

test("offers a compare control that is separate from the selection", () => {
  const markup = render([entry("run-a"), entry("run-b")], "run-a", ["run-b"]);

  // Comparing one run and displaying another are different choices, so the
  // ticked box and the current row need not be the same row.
  const ticked = markup.slice(markup.indexOf('data-testid="compare-run-b"'));
  assert.match(ticked.slice(0, 120), /checked=""/);

  const unticked = markup.slice(markup.indexOf('data-testid="compare-run-a"'));
  assert.doesNotMatch(unticked.slice(0, 120), /checked=""/);
});
