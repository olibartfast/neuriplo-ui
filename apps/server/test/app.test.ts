import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildServer } from "../src/app.js";
import {
  CapabilitiesDiscoveryError,
  type NeuriploCapabilities,
} from "../src/capabilities.js";
import { RunExecutionError, type RunOutcome } from "../src/runner.js";

const fixture: NeuriploCapabilities = {
  schema_version: 1,
  producer: { name: "neuriplo-infer", version: "0.7.0" },
  execution: {
    workflows: [
      {
        id: "client_server",
        backends: [],
        protocols: [{ id: "kserve_v2", transports: ["http"] }],
        parameters: { required: ["kserve_endpoint"], optional: [] },
      },
    ],
  },
  source_types: [{ id: "image", input: "file_path" }],
  parameters: {
    kserve_endpoint: { cli_flag: "kserve_endpoint", value_type: "url" },
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

test("GET /api/capabilities returns the CLI contract", async (context) => {
  const app = buildServer({
    loadCapabilities: async () => fixture,
    logger: false,
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/capabilities",
  });

  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), fixture);
});

test("GET /api/capabilities reports missing configuration", async (context) => {
  const app = buildServer({
    loadCapabilities: async () => {
      throw new CapabilitiesDiscoveryError(
        "not_configured",
        "NEURIPLO_INFER_BIN is not configured",
      );
    },
    logger: false,
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/capabilities",
  });

  assert.equal(response.statusCode, 503);
  assert.deepEqual(response.json(), {
    status: "unavailable",
    error: {
      code: "not_configured",
      message: "NEURIPLO_INFER_BIN is not configured",
    },
  });
});

test("GET /api/capabilities reports discovery failures", async (context) => {
  const app = buildServer({
    loadCapabilities: async () => {
      throw new CapabilitiesDiscoveryError(
        "execution_failed",
        "Failed to execute neuriplo-infer --capabilities",
      );
    },
    logger: false,
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "GET",
    url: "/api/capabilities",
  });

  assert.equal(response.statusCode, 502);
  assert.equal(response.json().error.code, "execution_failed");
});

// An existing path, because the adapter refuses sources it cannot find.
const existingSource = fileURLToPath(import.meta.url);

const runBody = {
  task: "object_detection",
  model: "yolo26",
  execution: {
    workflow: "client_server",
    protocol: "kserve_v2",
    transport: "http",
  },
  source: { type: "image", paths: [existingSource] },
  parameters: { kserve_endpoint: "http://127.0.0.1:8000" },
};

function outcomeFor(overrides: Partial<RunOutcome> = {}): RunOutcome {
  return {
    runId: "0e2b1c4a-9d51-4f7c-8a3b-6c5d4e3f2a1b",
    directory: "/tmp/neuriplo-ui-runs/0e2b1c4a-9d51-4f7c-8a3b-6c5d4e3f2a1b",
    args: [],
    binaryPath: "/opt/neuriplo-infer",
    exitCode: 0,
    signal: null,
    timedOut: false,
    durationMs: 12.7,
    stdout: "",
    stderr: "",
    artifacts: [],
    ...overrides,
  };
}

test("POST /api/runs returns a structured run result", async (context) => {
  let seenArgs: string[] = [];
  const app = buildServer({
    loadCapabilities: async () => fixture,
    runInference: async (args) => {
      seenArgs = args;
      return outcomeFor({
        args,
        stdout: '{"detections":[]}',
        stderr: "I0000 done\n",
        artifacts: [
          {
            name: "data/output/processed.png",
            media_type: "image/png",
            bytes: 42,
          },
        ],
      });
    },
    logger: false,
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/runs",
    payload: runBody,
  });

  assert.equal(response.statusCode, 200);
  const body = response.json();
  assert.equal(body.status, "success");
  assert.equal(body.task, "object_detection");
  assert.equal(body.execution.transport, "http");
  assert.deepEqual(body.result, { detections: [] });
  assert.deepEqual(seenArgs, [
    "--type=yolo26",
    "--kserve_endpoint=http://127.0.0.1:8000",
    `--source=${existingSource}`,
  ]);
  assert.deepEqual(body.artifacts, [
    {
      name: "data/output/processed.png",
      media_type: "image/png",
      bytes: 42,
      url: "/api/runs/0e2b1c4a-9d51-4f7c-8a3b-6c5d4e3f2a1b/artifacts/data/output/processed.png",
    },
  ]);
});

test("POST /api/runs reports a failed pipeline as a completed run", async (context) => {
  const app = buildServer({
    loadCapabilities: async () => fixture,
    runInference: async () =>
      outcomeFor({
        exitCode: 1,
        stderr: "E0000 Weights file /nope doesn't exist\n",
      }),
    logger: false,
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/runs",
    payload: runBody,
  });

  // The run happened, so this is a 200 describing a failure rather than an
  // adapter error.
  assert.equal(response.statusCode, 200);
  assert.equal(response.json().status, "failed");
  assert.equal(response.json().error.code, "run_failed");
  assert.match(response.json().error.message, /Weights file/);
});

test("POST /api/runs reports the failing line, not a glog continuation", async (context) => {
  const app = buildServer({
    loadCapabilities: async () => fixture,
    runInference: async () =>
      outcomeFor({
        exitCode: 1,
        // glog wraps a long message onto ">" continuation lines, which say
        // nothing on their own.
        stderr: [
          "I0000 Running using OpenCV DNN runtime",
          "E0000 Error: OpenCV(4.10.0) onnx_importer.cpp:1057: error in 'handleNode'",
          "> Node [Floor@ai.onnx]:(onnx_node!/model.11/Floor) parse error",
          ">",
          "",
        ].join("\n"),
      }),
    logger: false,
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/runs",
    payload: runBody,
  });

  assert.equal(response.json().status, "failed");
  assert.match(response.json().error.message, /Error: OpenCV/);
});

test("POST /api/runs rejects a configuration the contract forbids", async (context) => {
  const app = buildServer({
    loadCapabilities: async () => fixture,
    runInference: async () => {
      assert.fail("must not spawn for an invalid request");
    },
    logger: false,
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/runs",
    payload: { ...runBody, parameters: {} },
  });

  assert.equal(response.statusCode, 400);
  assert.deepEqual(response.json().error, {
    code: "missing_parameter",
    message: "Parameter is required for this selection: kserve_endpoint",
    field: "kserve_endpoint",
  });
});

test("POST /api/runs reports a missing binary", async (context) => {
  const app = buildServer({
    loadCapabilities: async () => fixture,
    runInference: async () => {
      throw new RunExecutionError(
        "not_configured",
        "NEURIPLO_INFER_BIN is not configured",
      );
    },
    logger: false,
  });
  context.after(() => app.close());

  const response = await app.inject({
    method: "POST",
    url: "/api/runs",
    payload: runBody,
  });

  assert.equal(response.statusCode, 503);
  assert.equal(response.json().error.code, "not_configured");
});

test("serves artifacts from the run directory only", async (context) => {
  const runRoot = await mkdtemp(join(tmpdir(), "neuriplo-ui-artifacts-"));
  context.after(() => rm(runRoot, { recursive: true, force: true }));

  const runId = "0e2b1c4a-9d51-4f7c-8a3b-6c5d4e3f2a1b";
  const runDirectory = join(runRoot, runId, "data", "output");
  await mkdir(runDirectory, { recursive: true });
  await writeFile(join(runDirectory, "processed.png"), "png-bytes");
  await writeFile(join(runRoot, "secret.txt"), "not yours");

  const app = buildServer({
    loadCapabilities: async () => fixture,
    runner: { runRoot },
    logger: false,
  });
  context.after(() => app.close());

  const served = await app.inject({
    method: "GET",
    url: `/api/runs/${runId}/artifacts/data/output/processed.png`,
  });
  assert.equal(served.statusCode, 200);
  assert.equal(served.headers["content-type"], "image/png");
  assert.equal(served.body, "png-bytes");

  const escaped = await app.inject({
    method: "GET",
    url: `/api/runs/${runId}/artifacts/..%2F..%2Fsecret.txt`,
  });
  assert.equal(escaped.statusCode, 404);

  const missing = await app.inject({
    method: "GET",
    url: `/api/runs/${runId}/artifacts/data/output/absent.png`,
  });
  assert.equal(missing.statusCode, 404);
});

test("GET /api/files lists the adapter's filesystem", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "neuriplo-ui-browse-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "models"), { recursive: true });
  await writeFile(join(root, "models", "yolo26.onnx"), "weights");

  const app = buildServer({
    loadCapabilities: async () => fixture,
    browse: { root },
    logger: false,
  });
  context.after(() => app.close());

  // No path asks the adapter where browsing starts.
  const start = await app.inject({ method: "GET", url: "/api/files" });
  assert.equal(start.statusCode, 200);
  assert.equal(start.json().path, root);
  assert.equal(start.json().parent, null);

  const listed = await app.inject({
    method: "GET",
    url: `/api/files?path=${encodeURIComponent(join(root, "models"))}`,
  });
  assert.equal(listed.statusCode, 200);
  assert.deepEqual(
    listed.json().entries.map((entry: { name: string }) => entry.name),
    ["yolo26.onnx"],
  );

  const escaped = await app.inject({
    method: "GET",
    url: `/api/files?path=${encodeURIComponent(join(root, ".."))}`,
  });
  assert.equal(escaped.statusCode, 403);
  assert.equal(escaped.json().error.code, "forbidden");

  const missing = await app.inject({
    method: "GET",
    url: `/api/files?path=${encodeURIComponent(join(root, "absent"))}`,
  });
  assert.equal(missing.statusCode, 404);
});
