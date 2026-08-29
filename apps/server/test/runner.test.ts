import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  executeRun,
  RunExecutionError,
  resolveArtifactPath,
} from "../src/runner.js";

/**
 * Stands in for neuriplo-infer: it echoes its arguments, writes an artifact
 * where the real binary would (relative to the working directory), and exits
 * with whatever code the test asks for.
 */
async function fakeBinary(directory: string, body: string): Promise<string> {
  const path = join(directory, "fake-infer.mjs");
  await writeFile(path, `#!/usr/bin/env node\n${body}\n`, { mode: 0o755 });
  return path;
}

async function scratch(): Promise<string> {
  return mkdtemp(join(tmpdir(), "neuriplo-ui-test-"));
}

test("captures stdout, stderr, exit code, and artifacts", async (context) => {
  const directory = await scratch();
  context.after(() => rm(directory, { recursive: true, force: true }));

  const binaryPath = await fakeBinary(
    directory,
    `import { mkdirSync, writeFileSync } from "node:fs";
     process.stdout.write(JSON.stringify({ args: process.argv.slice(2) }));
     process.stderr.write("I0000 inference done\\n");
     mkdirSync("data/output", { recursive: true });
     writeFileSync("data/output/processed.png", "not-really-a-png");`,
  );

  const outcome = await executeRun(["--type=yolo26"], {
    binaryPath,
    runRoot: join(directory, "runs"),
  });

  assert.equal(outcome.exitCode, 0);
  assert.equal(outcome.timedOut, false);
  assert.ok(outcome.durationMs >= 0);
  assert.deepEqual(JSON.parse(outcome.stdout), { args: ["--type=yolo26"] });
  assert.match(outcome.stderr, /inference done/);
  assert.deepEqual(outcome.artifacts, [
    {
      name: "data/output/processed.png",
      media_type: "image/png",
      bytes: 16,
    },
  ]);
});

test("reports a non-zero exit without throwing", async (context) => {
  const directory = await scratch();
  context.after(() => rm(directory, { recursive: true, force: true }));

  const binaryPath = await fakeBinary(
    directory,
    `process.stderr.write("E0000 Weights file /nope doesn't exist\\n");
     process.exit(1);`,
  );

  const outcome = await executeRun(["--type=yolo26"], {
    binaryPath,
    runRoot: join(directory, "runs"),
  });

  assert.equal(outcome.exitCode, 1);
  assert.match(outcome.stderr, /Weights file/);
  assert.deepEqual(outcome.artifacts, []);
});

test("kills a run that outlives the timeout", async (context) => {
  const directory = await scratch();
  context.after(() => rm(directory, { recursive: true, force: true }));

  const binaryPath = await fakeBinary(
    directory,
    `setTimeout(() => {}, 60_000);`,
  );

  const outcome = await executeRun([], {
    binaryPath,
    runRoot: join(directory, "runs"),
    timeoutMs: 150,
  });

  assert.equal(outcome.timedOut, true);
  assert.equal(outcome.signal, "SIGKILL");
});

test("truncates output beyond the byte budget", async (context) => {
  const directory = await scratch();
  context.after(() => rm(directory, { recursive: true, force: true }));

  const binaryPath = await fakeBinary(
    directory,
    `process.stdout.write("x".repeat(4096));`,
  );

  const outcome = await executeRun([], {
    binaryPath,
    runRoot: join(directory, "runs"),
    maxOutputBytes: 64,
  });

  assert.match(outcome.stdout, /^x{64}\n\[output truncated at 64 bytes\]$/);
});

test("requires NEURIPLO_INFER_BIN", async () => {
  await assert.rejects(
    executeRun([], { binaryPath: "  " }),
    (error: unknown) =>
      error instanceof RunExecutionError && error.code === "not_configured",
  );
});

test("normalizes a missing binary into a spawn failure", async (context) => {
  const directory = await scratch();
  context.after(() => rm(directory, { recursive: true, force: true }));

  await assert.rejects(
    executeRun([], {
      binaryPath: join(directory, "absent"),
      runRoot: join(directory, "runs"),
    }),
    (error: unknown) =>
      error instanceof RunExecutionError && error.code === "spawn_failed",
  );
});

test("confines artifact paths to their run directory", async (context) => {
  const directory = await scratch();
  context.after(() => rm(directory, { recursive: true, force: true }));

  const runRoot = join(directory, "runs");
  const runId = "0e2b1c4a-9d51-4f7c-8a3b-6c5d4e3f2a1b";

  assert.equal(
    resolveArtifactPath(runId, "data/output/processed.png", { runRoot }),
    join(runRoot, runId, "data/output/processed.png"),
  );
  assert.equal(
    resolveArtifactPath(runId, "../../etc/passwd", { runRoot }),
    null,
  );
  assert.equal(resolveArtifactPath(runId, "/etc/passwd", { runRoot }), null);
  assert.equal(resolveArtifactPath(runId, "", { runRoot }), null);
  assert.equal(resolveArtifactPath("../../etc", "passwd", { runRoot }), null);
});

test("runs the binary inside its own directory", async (context) => {
  const directory = await scratch();
  context.after(() => rm(directory, { recursive: true, force: true }));

  const binaryPath = await fakeBinary(
    directory,
    `import { writeFileSync } from "node:fs";
     writeFileSync("cwd.txt", process.cwd());`,
  );
  const runRoot = join(directory, "runs");

  const first = await executeRun([], { binaryPath, runRoot });
  const second = await executeRun([], { binaryPath, runRoot });

  assert.notEqual(first.runId, second.runId);
  assert.equal(
    await readFile(join(first.directory, "cwd.txt"), "utf8"),
    first.directory,
  );
  assert.notEqual(first.directory, second.directory);
});
