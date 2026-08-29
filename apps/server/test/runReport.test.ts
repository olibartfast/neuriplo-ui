import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { CapabilityRunReport } from "../src/capabilities.js";
import { parseRunDiagnostics, readRunDiagnostics } from "../src/runReport.js";

const contract: CapabilityRunReport = {
  schema_version: 1,
  path: "data/output/run_report.json",
  stages: [
    "configuration",
    "model_load",
    "source",
    "preprocess",
    "inference",
    "postprocess",
    "render",
    "unknown",
  ],
};

const complete = {
  schema_version: 1,
  status: "success",
  stage: "render",
  metrics: {
    wall_time_ms: 812.5,
    samples: 1,
    frames: null,
    throughput_per_second: 4.0,
    stages_ms: {
      model_load: 500.0,
      preprocess: 3.5,
      inference: 250.0,
      postprocess: 1.5,
      render: 40.0,
    },
  },
  error: null,
};

async function withRunDirectory(
  write: ((directory: string) => Promise<void>) | null,
): Promise<{ directory: string; cleanup: () => Promise<void> }> {
  const directory = await mkdtemp(join(tmpdir(), "neuriplo-run-report-"));
  if (write) await write(directory);
  return {
    directory,
    cleanup: () => rm(directory, { recursive: true, force: true }),
  };
}

async function writeReport(directory: string, document: unknown) {
  await mkdir(join(directory, "data", "output"), { recursive: true });
  await writeFile(
    join(directory, "data", "output", "run_report.json"),
    typeof document === "string" ? document : JSON.stringify(document),
  );
}

test("reads a complete producer report", async (context) => {
  const run = await withRunDirectory((d) => writeReport(d, complete));
  context.after(run.cleanup);

  const diagnostics = await readRunDiagnostics(run.directory, contract);

  assert.equal(diagnostics?.status, "success");
  assert.equal(diagnostics?.metrics?.wall_time_ms, 812.5);
  assert.equal(diagnostics?.metrics?.stages_ms.inference, 250.0);
  assert.equal(diagnostics?.metrics?.throughput_per_second, 4.0);
  assert.equal(diagnostics?.metrics?.frames, null);
});

test("returns nothing when the build advertises no report", async (context) => {
  const run = await withRunDirectory((d) => writeReport(d, complete));
  context.after(run.cleanup);

  // An older binary publishes no diagnostics; the run response then carries
  // none rather than the adapter reading a file it was never promised.
  assert.equal(await readRunDiagnostics(run.directory, null), null);
});

test("returns nothing when the run wrote no report", async (context) => {
  const run = await withRunDirectory(null);
  context.after(run.cleanup);

  assert.equal(await readRunDiagnostics(run.directory, contract), null);
});

test("keeps a partial envelope and leaves unmeasured values null", async (context) => {
  const run = await withRunDirectory((d) =>
    writeReport(d, {
      schema_version: 1,
      status: "failed",
      stage: "model_load",
      metrics: {
        wall_time_ms: 546.9,
        samples: 0,
        frames: null,
        throughput_per_second: null,
        stages_ms: { model_load: 546.7 },
      },
      error: { stage: "model_load", message: "could not open weights" },
    }),
  );
  context.after(run.cleanup);

  const diagnostics = await readRunDiagnostics(run.directory, contract);

  assert.equal(diagnostics?.metrics?.stages_ms.model_load, 546.7);
  // Stages the producer never measured must not become zeros.
  assert.equal(diagnostics?.metrics?.stages_ms.inference, null);
  assert.equal(diagnostics?.metrics?.stages_ms.render, null);
  assert.equal(diagnostics?.error?.stage, "model_load");
  assert.equal(diagnostics?.error?.message, "could not open weights");
});

test("drops a report from an unadvertised schema version", async (context) => {
  const run = await withRunDirectory((d) =>
    writeReport(d, { ...complete, schema_version: 2 }),
  );
  context.after(run.cleanup);

  // A newer document may have changed the meaning of the same field names.
  assert.equal(await readRunDiagnostics(run.directory, contract), null);
});

test("survives an unreadable or malformed report", async (context) => {
  const run = await withRunDirectory((d) => writeReport(d, "{not json"));
  context.after(run.cleanup);

  assert.equal(await readRunDiagnostics(run.directory, contract), null);
});

test("refuses a report path that escapes the run directory", async (context) => {
  const run = await withRunDirectory((d) => writeReport(d, complete));
  context.after(run.cleanup);

  for (const path of ["../outside.json", "/etc/passwd"]) {
    assert.equal(
      await readRunDiagnostics(run.directory, { ...contract, path }),
      null,
    );
  }
});

test("treats a metrics object with nothing measured as no metrics", () => {
  const diagnostics = parseRunDiagnostics(
    {
      schema_version: 1,
      status: "success",
      stage: "render",
      metrics: {
        wall_time_ms: null,
        samples: null,
        frames: null,
        throughput_per_second: null,
        stages_ms: {},
      },
      error: null,
    },
    1,
  );

  assert.equal(diagnostics?.metrics, null);
});

test("rejects non-numeric measurements rather than coercing them", () => {
  const diagnostics = parseRunDiagnostics(
    {
      schema_version: 1,
      status: "success",
      stage: "render",
      metrics: {
        wall_time_ms: "812.5",
        samples: 1,
        frames: Number.NaN,
        throughput_per_second: null,
        stages_ms: { inference: "fast" },
      },
      error: null,
    },
    1,
  );

  assert.equal(diagnostics?.metrics?.wall_time_ms, null);
  assert.equal(diagnostics?.metrics?.frames, null);
  assert.equal(diagnostics?.metrics?.stages_ms.inference, null);
  assert.equal(diagnostics?.metrics?.samples, 1);
});

test("keeps an unknown stage as the producer wrote it", () => {
  const diagnostics = parseRunDiagnostics(
    {
      schema_version: 1,
      status: "failed",
      stage: "unknown",
      metrics: null,
      error: { stage: "unknown", message: null },
    },
    1,
  );

  // The reader passes it through; deciding that "unknown" is not worth showing
  // belongs to the response layer, which has the rest of the run to compare.
  assert.equal(diagnostics?.stage, "unknown");
  assert.equal(diagnostics?.error?.stage, "unknown");
  assert.equal(diagnostics?.error?.message, null);
});
