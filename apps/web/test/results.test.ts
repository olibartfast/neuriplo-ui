import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { promisify } from "node:util";
import {
  copyText,
  describeExecution,
  formatCommand,
  formatDuration,
  formatJson,
  quoteShellArgument,
  summarizeOutcome,
} from "../src/results.js";

test("formats durations in stable units", () => {
  assert.equal(formatDuration(0), "0 ms");
  assert.equal(formatDuration(842.4), "842 ms");
  assert.equal(formatDuration(999), "999 ms");
  assert.equal(formatDuration(1000), "1.00 s");
  assert.equal(formatDuration(1234.5), "1.23 s");
  assert.equal(formatDuration(59_999), "60.00 s");
  assert.equal(formatDuration(63_000), "1 min 3.0 s");
  assert.equal(formatDuration(Number.NaN), "—");
  assert.equal(formatDuration(-1), "—");
});

test("leaves ordinary arguments unquoted", () => {
  for (const argument of [
    "--task=detection",
    "/opt/models/yolo26.onnx",
    "0.25",
    "a,b:c%d@e+f=g",
  ]) {
    assert.equal(quoteShellArgument(argument), argument);
  }
});

test("quotes shell-sensitive arguments without changing their value", () => {
  assert.equal(quoteShellArgument(""), "''");
  assert.equal(quoteShellArgument("two words"), "'two words'");
  assert.equal(quoteShellArgument("$HOME"), "'$HOME'");
  assert.equal(quoteShellArgument("`id`"), "'`id`'");
  assert.equal(quoteShellArgument('say "hi"'), `'say "hi"'`);
  assert.equal(quoteShellArgument("it's"), `'it'\\''s'`);
  assert.equal(quoteShellArgument("a\nb"), "'a\nb'");
  assert.equal(quoteShellArgument("a;rm -rf /"), "'a;rm -rf /'");
  assert.equal(quoteShellArgument("*"), "'*'");
});

test("round-trips a quoted command through a POSIX shell", async () => {
  const run = promisify(execFile);

  // The quoting claim is only worth making if a real shell agrees, including
  // for the argument that would otherwise glob.
  const args = ["", "two words", "it's", "$HOME", "`id`", "a\nb", "*"];
  const command = formatCommand({ bin: "/bin/echo", args });
  const { stdout } = await run("/bin/sh", ["-c", command]);

  assert.equal(stdout, `${args.join(" ")}\n`);
});

test("joins the binary and arguments into a reproducible command", () => {
  assert.equal(
    formatCommand({
      bin: "/opt/neuriplo/neuriplo-infer",
      args: ["--task", "detection", "--source", "/tmp/a photo.jpg"],
    }),
    "/opt/neuriplo/neuriplo-infer --task detection --source '/tmp/a photo.jpg'",
  );
  assert.equal(
    formatCommand({ bin: "/usr/local/bin/n i", args: [] }),
    "'/usr/local/bin/n i'",
  );
});

test("formats JSON without changing the producer's values", () => {
  assert.equal(formatJson({}), "{}");
  assert.equal(formatJson([]), "[]");
  assert.equal(formatJson(0.30000000000000004), "0.30000000000000004");
  assert.equal(formatJson("text"), '"text"');
  assert.equal(formatJson(null), "null");
  assert.equal(
    formatJson({ detections: [{ label: "cat", score: 0.5 }] }),
    '{\n  "detections": [\n    {\n      "label": "cat",\n      "score": 0.5\n    }\n  ]\n}',
  );
});

test("summarizes how the process ended", () => {
  assert.deepEqual(
    summarizeOutcome({
      exit_code: 0,
      signal: null,
      timed_out: false,
      duration_ms: 1200,
      artifacts: [1],
    }),
    ["exit 0", "1.20 s wall time", "1 artifact"],
  );
  assert.deepEqual(
    summarizeOutcome({
      exit_code: 1,
      signal: null,
      timed_out: false,
      duration_ms: 300,
      artifacts: [],
    }),
    ["exit 1", "300 ms wall time", "0 artifacts"],
  );
  assert.deepEqual(
    summarizeOutcome({
      exit_code: null,
      signal: "SIGKILL",
      timed_out: true,
      duration_ms: 30_000,
      artifacts: [],
    })[0],
    "timed out",
  );
  assert.deepEqual(
    summarizeOutcome({
      exit_code: null,
      signal: "SIGSEGV",
      timed_out: false,
      duration_ms: 10,
      artifacts: [],
    })[0],
    "terminated by SIGSEGV",
  );
  assert.deepEqual(
    summarizeOutcome({
      exit_code: null,
      signal: null,
      timed_out: false,
      duration_ms: 10,
      artifacts: [],
    })[0],
    "exit unknown",
  );
});

test("describes execution from whichever fields apply", () => {
  assert.equal(
    describeExecution({
      workflow: "local",
      backend: "onnx_runtime",
      protocol: null,
      transport: null,
    }),
    "local · onnx_runtime",
  );
  assert.equal(
    describeExecution({
      workflow: "client_server",
      backend: null,
      protocol: "kserve_v2",
      transport: "grpc",
    }),
    "client_server · kserve_v2/grpc",
  );
  assert.equal(
    describeExecution({
      workflow: "client_server",
      backend: null,
      protocol: "kserve_v2",
      transport: null,
    }),
    "client_server · kserve_v2",
  );
});

test("reports a successful clipboard write", async () => {
  const written: string[] = [];
  const state = await copyText("neuriplo-infer --task detection", {
    writeText: async (text) => {
      written.push(text);
    },
  });

  assert.deepEqual(state, { status: "copied" });
  assert.deepEqual(written, ["neuriplo-infer --task detection"]);
});

test("keeps a rejected or unavailable clipboard non-destructive", async () => {
  const rejected = await copyText("cmd", {
    writeText: async () => {
      throw new Error("denied");
    },
  });
  assert.equal(rejected.status, "failed");
  assert.match(
    rejected.status === "failed" ? rejected.message : "",
    /select the command/i,
  );

  const missing = await copyText("cmd", undefined);
  assert.equal(missing.status, "failed");
  assert.match(
    missing.status === "failed" ? missing.message : "",
    /unavailable/i,
  );
});
