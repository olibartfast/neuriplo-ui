// tsx compiles this file with the classic JSX runtime, so React stays in scope.
import React from "react";
import assert from "node:assert/strict";
import { test } from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { NeuriploCapabilities } from "../src/contract.js";
import type { RunResult } from "../src/run.js";
import { RunPanel, type RunState } from "../src/RunView.js";

const capabilities = {
  schema_version: 1,
  producer: { name: "neuriplo-infer", version: "0.9.1" },
} as unknown as NeuriploCapabilities;

const baseRun: RunResult = {
  status: "success",
  run_id: "run-2f7c",
  task: "detection",
  model: "yolo26",
  execution: {
    workflow: "local",
    backend: "onnx_runtime",
    protocol: null,
    transport: null,
  },
  source: { type: "image", paths: ["/tmp/fixture.jpg"] },
  command: {
    bin: "/opt/neuriplo/neuriplo-infer",
    args: ["--task", "detection", "--source", "/tmp/fixture.jpg"],
  },
  exit_code: 0,
  signal: null,
  timed_out: false,
  duration_ms: 1234,
  artifacts: [],
  result: null,
  stdout: "",
  stderr: "",
  error: null,
};

function render(state: RunState): string {
  return renderToStaticMarkup(
    <RunPanel state={state} capabilities={capabilities} />,
  );
}

function done(patch: Partial<RunResult>): string {
  return render({ status: "done", run: { ...baseRun, ...patch } });
}

test("shows a structured result, command, wall time, logs, and artifacts", () => {
  const markup = done({
    result: { detections: [{ label: "cat", score: 0.91 }] },
    stdout: '{"detections":[]}',
    stderr: "I0101 loading model\n",
    artifacts: [
      {
        name: "output.jpg",
        media_type: "image/jpeg",
        bytes: 2048,
        url: "/api/runs/run-2f7c/artifacts/output.jpg",
      },
    ],
  });

  assert.match(markup, />Succeeded</);
  assert.match(markup, /&quot;detections&quot;/);
  assert.match(
    markup,
    /\/opt\/neuriplo\/neuriplo-infer --task detection --source \/tmp\/fixture\.jpg/,
  );
  // Wall time is the whole process and must never be labelled inference latency.
  assert.match(markup, /Wall time \(whole process\)/);
  assert.match(markup, /1\.23 s/);
  assert.doesNotMatch(markup, /latency/i);
  assert.match(markup, /data-testid="log-stdout"/);
  assert.match(markup, /data-testid="log-stderr"/);
  assert.match(markup, /data-testid="artifact-preview-output\.jpg"/);
  assert.match(markup, /2\.0 KB/);
  assert.match(markup, /run-2f7c/);
});

test("omits the structured result section when the producer emitted none", () => {
  const markup = done({
    result: null,
    stdout: "I0101 rendered data/output/frame.jpg\n",
    artifacts: [
      {
        name: "frame.jpg",
        media_type: "image/jpeg",
        bytes: 100,
        url: "/api/runs/run-2f7c/artifacts/frame.jpg",
      },
    ],
  });

  // A null result is an expected state, not a parse failure: artifacts and
  // logs stay available and nothing is synthesized from stdout.
  assert.doesNotMatch(markup, /Structured result/);
  assert.doesNotMatch(markup, /data-testid="structured-result"/);
  assert.match(markup, /data-testid="artifact-preview-frame\.jpg"/);
  assert.match(markup, /data-testid="log-stdout"/);
});

test("renders scalar and empty structured results generically", () => {
  for (const [result, expected] of [
    [{}, "{}"],
    [[], "[]"],
    [42, "42"],
    ["done", '&quot;done&quot;'],
  ] as Array<[unknown, string]>) {
    const markup = done({ result });
    assert.match(markup, /Structured result/);
    assert.ok(
      markup.includes(expected),
      `expected ${expected} in the structured result section`,
    );
  }
});

test("opens stderr on a failed run and shows the producer's own message", () => {
  const markup = done({
    status: "failed",
    exit_code: 1,
    stderr: "E0101 could not open weights: /opt/models/missing.onnx\n",
    error: {
      code: "run_failed",
      message: "could not open weights: /opt/models/missing.onnx",
    },
  });

  assert.match(markup, />Failed</);
  assert.match(markup, /could not open weights: \/opt\/models\/missing\.onnx/);
  assert.match(markup, /<details class="log" open=""><summary[^>]*>stderr/);
  assert.match(markup, /<details class="log"><summary[^>]*>stdout/);
  assert.match(markup, /exit 1/);
});

test("keeps both streams collapsed after a successful run", () => {
  const markup = done({ stdout: "ok", stderr: "warn" });
  assert.doesNotMatch(markup, /<details class="log" open="">/);
});

test("names timeout and signal termination rather than a missing exit code", () => {
  const timedOut = done({
    status: "failed",
    exit_code: null,
    timed_out: true,
    duration_ms: 30_000,
    error: {
      code: "timeout",
      message: "neuriplo-infer exceeded the configured run timeout",
    },
  });
  assert.match(timedOut, /timed out/);
  assert.match(timedOut, /Timed out/);

  const killed = done({
    status: "failed",
    exit_code: null,
    signal: "SIGKILL",
    error: { code: "terminated", message: "neuriplo-infer was terminated by SIGKILL" },
  });
  assert.match(killed, /terminated by SIGKILL/);
  assert.match(killed, /Signal/);
});

test("keeps a rejected request distinct from a run that started and failed", () => {
  const markup = render({
    status: "error",
    code: "unknown_backend",
    message: "The build does not provide backend tensorrt.",
  });

  assert.match(markup, />Rejected</);
  assert.match(markup, /neuriplo-infer was not started/);
  // No process ran, so nothing may imply one did.
  assert.doesNotMatch(markup, /data-testid="run-command"/);
  assert.doesNotMatch(markup, /Wall time/);
  assert.doesNotMatch(markup, /data-testid="log-stderr"/);
});

test("quotes a hostile-looking command exactly as it was spawned", () => {
  const markup = done({
    command: {
      bin: "/opt/neuriplo/neuriplo-infer",
      args: ["--labels", "", "--prompt", "a dog; rm -rf /", "--note", "$HOME"],
    },
  });

  assert.ok(
    markup.includes(
      "/opt/neuriplo/neuriplo-infer --labels &#x27;&#x27; --prompt &#x27;a dog; rm -rf /&#x27; --note &#x27;$HOME&#x27;",
    ),
    "the command must be shown with POSIX quoting",
  );
  assert.match(markup, /data-testid="copy-command"/);
});

test("labels empty and truncated log streams", () => {
  const empty = done({ stdout: "", stderr: "   \n" });
  assert.match(empty, /stdout \(empty\)/);
  assert.match(empty, /stderr \(empty\)/);
  assert.match(empty, /No output/);

  const truncated = done({
    stdout: "line\n[output truncated at 1048576 bytes]",
  });
  assert.match(truncated, /\[output truncated at 1048576 bytes\]/);
});

test("reports idle and running states without inventing a result", () => {
  const idle = render({ status: "idle" });
  assert.match(idle, />Idle</);
  assert.doesNotMatch(idle, /data-testid="run-command"/);

  const running = render({ status: "running" });
  assert.match(running, />Running</);
  assert.doesNotMatch(running, /data-testid="run-summary"/);
});
