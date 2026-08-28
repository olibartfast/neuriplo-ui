import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CapabilitiesDiscoveryError,
  discoverCapabilities,
  runReportContract,
  type CapabilitiesCommandRunner,
  type NeuriploCapabilities,
} from "../src/capabilities.js";

const fixture: NeuriploCapabilities = {
  schema_version: 1,
  producer: { name: "neuriplo-infer", version: "0.7.0" },
  execution: {
    workflows: [
      {
        id: "local",
        backends: ["opencv_dnn"],
        protocols: [],
        parameters: { required: ["weights"], optional: [] },
      },
    ],
  },
  source_types: [{ id: "image", input: "file_path" }],
  parameters: {
    weights: { cli_flag: "weights", value_type: "path" },
  },
  tasks: [
    {
      id: "object_detection",
      models: [
        {
          id: "yolo26",
          aliases: [],
          patterns: [],
          parameters: { required: [], optional: [] },
        },
      ],
      sources: { types: ["image"], min_items: 1, max_items: 1 },
      parameters: { required: [], optional: [] },
    },
  ],
};

test("discovers and validates capabilities", async () => {
  const runCommand: CapabilitiesCommandRunner = async (binaryPath) => {
    assert.equal(binaryPath, "/opt/neuriplo-infer");
    return { stdout: JSON.stringify(fixture), stderr: "" };
  };

  const capabilities = await discoverCapabilities(
    "/opt/neuriplo-infer",
    runCommand,
  );

  assert.deepEqual(capabilities, fixture);
});

test("requires NEURIPLO_INFER_BIN", async () => {
  await assert.rejects(
    discoverCapabilities(""),
    (error: unknown) =>
      error instanceof CapabilitiesDiscoveryError &&
      error.code === "not_configured",
  );
});

test("rejects invalid JSON", async () => {
  await assert.rejects(
    discoverCapabilities("/opt/neuriplo-infer", async () => ({
      stdout: "not-json",
      stderr: "",
    })),
    (error: unknown) =>
      error instanceof CapabilitiesDiscoveryError &&
      error.code === "invalid_response",
  );
});

test("rejects unsupported schema versions", async () => {
  await assert.rejects(
    discoverCapabilities("/opt/neuriplo-infer", async () => ({
      stdout: JSON.stringify({ ...fixture, schema_version: 3 }),
      stderr: "",
    })),
    (error: unknown) =>
      error instanceof CapabilitiesDiscoveryError &&
      error.code === "unsupported_schema",
  );
});

test("accepts both published schema versions", async () => {
  // Version 2 added the diagnostics section. A version 1 binary advertises
  // none, which is already the "no run report" case, so both are usable.
  const withDiagnostics = {
    ...fixture,
    schema_version: 2,
    diagnostics: {
      run_report: {
        schema_version: 1,
        path: "data/output/run_report.json",
        stages: ["configuration", "inference", "unknown"],
      },
    },
  };

  const v2 = await discoverCapabilities("/opt/neuriplo-infer", async () => ({
    stdout: JSON.stringify(withDiagnostics),
    stderr: "",
  }));
  assert.equal(v2.schema_version, 2);
  assert.equal(runReportContract(v2)?.path, "data/output/run_report.json");

  const v1 = await discoverCapabilities("/opt/neuriplo-infer", async () => ({
    stdout: JSON.stringify({ ...fixture, schema_version: 1 }),
    stderr: "",
  }));
  assert.equal(runReportContract(v1), null);
});

test("rejects unresolved parameter references", async () => {
  const invalidFixture = structuredClone(fixture);
  invalidFixture.tasks[0].parameters.optional.push("missing_parameter");

  await assert.rejects(
    discoverCapabilities("/opt/neuriplo-infer", async () => ({
      stdout: JSON.stringify(invalidFixture),
      stderr: "",
    })),
    (error: unknown) =>
      error instanceof CapabilitiesDiscoveryError &&
      error.code === "invalid_response",
  );
});
