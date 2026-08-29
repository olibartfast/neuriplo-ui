import assert from "node:assert/strict";
import { test } from "node:test";
import type { NeuriploCapabilities } from "../src/capabilities.js";
import { planRun, RunRequestError } from "../src/runs.js";

const fixture: NeuriploCapabilities = {
  schema_version: 1,
  producer: { name: "neuriplo-infer", version: "0.7.0" },
  execution: {
    workflows: [
      {
        id: "local",
        backends: ["onnx_runtime"],
        protocols: [],
        parameters: {
          required: ["weights"],
          optional: ["use_gpu", "iterations"],
        },
      },
      {
        id: "client_server",
        backends: [],
        protocols: [{ id: "kserve_v2", transports: ["http", "grpc"] }],
        parameters: {
          required: ["kserve_endpoint"],
          optional: ["kserve_transport"],
        },
      },
    ],
  },
  source_types: [
    { id: "image", input: "file_path" },
    { id: "video", input: "file_path" },
  ],
  parameters: {
    weights: { cli_flag: "weights", value_type: "path" },
    use_gpu: { cli_flag: "use-gpu", value_type: "boolean", default: false },
    iterations: {
      cli_flag: "iterations",
      value_type: "integer",
      default: 10,
      minimum: 1,
    },
    min_confidence: {
      cli_flag: "min_confidence",
      value_type: "number",
      minimum: 0,
      maximum: 1,
    },
    kserve_endpoint: { cli_flag: "kserve_endpoint", value_type: "url" },
    kserve_transport: {
      cli_flag: "kserve_transport",
      value_type: "enum",
      values: ["http", "grpc"],
    },
  },
  tasks: [
    {
      id: "object_detection",
      models: [
        {
          id: "yolo",
          aliases: ["yolo26"],
          patterns: ["yolo*"],
          parameters: { required: [], optional: [] },
        },
      ],
      sources: { types: ["image", "video"], min_items: 1, max_items: 1 },
      parameters: { required: [], optional: ["min_confidence"] },
    },
    {
      id: "optical_flow",
      models: [
        {
          id: "raft",
          aliases: [],
          patterns: [],
          parameters: { required: [], optional: [] },
        },
      ],
      sources: { types: ["image"], min_items: 2, max_items: -1 },
      parameters: { required: [], optional: [] },
    },
  ],
};

// Keeps the plan deterministic: path resolution is exercised separately.
const identity = (path: string) => path;

const localRun = {
  task: "object_detection",
  model: "yolo26",
  execution: { workflow: "local", backend: "onnx_runtime" },
  source: { type: "image", paths: ["/fixtures/bus.jpg"] },
  parameters: { weights: "/models/yolo26.onnx" },
};

function plan(body: unknown) {
  return planRun(fixture, body, { resolveSource: identity });
}

test("builds a deterministic argument array", () => {
  const planned = plan({
    ...localRun,
    parameters: {
      weights: "/models/yolo26.onnx",
      min_confidence: "0.4",
      use_gpu: "true",
    },
  });

  assert.deepEqual(planned.args, [
    "--type=yolo26",
    "--weights=/models/yolo26.onnx",
    "--use-gpu=true",
    "--min_confidence=0.4",
    "--source=/fixtures/bus.jpg",
  ]);
  assert.equal(planned.model.id, "yolo");
  assert.equal(planned.backend, "onnx_runtime");
});

test("passes the requested selector through so the binary resolves it", () => {
  assert.equal(
    plan({ ...localRun, model: "yolo-custom" }).args[0],
    "--type=yolo-custom",
  );
});

test("drops untouched optional parameters", () => {
  const planned = plan(localRun);
  assert.deepEqual(planned.args, [
    "--type=yolo26",
    "--weights=/models/yolo26.onnx",
    "--source=/fixtures/bus.jpg",
  ]);
});

test("joins the sources a task accepts", () => {
  const planned = plan({
    task: "optical_flow",
    model: "raft",
    execution: { workflow: "local", backend: "onnx_runtime" },
    source: { type: "image", paths: ["/a.png", "/b.png", "/c.png"] },
    parameters: { weights: "/models/raft.onnx" },
  });

  assert.equal(planned.args.at(-1), "--source=/a.png,/b.png,/c.png");
});

test("rejects a model selector the task does not advertise", () => {
  assert.throws(
    () => plan({ ...localRun, model: "raft" }),
    (error: unknown) =>
      error instanceof RunRequestError && error.code === "unknown_model",
  );
});

test("rejects a backend the build does not offer", () => {
  assert.throws(
    () =>
      plan({
        ...localRun,
        execution: { workflow: "local", backend: "tensorrt" },
      }),
    (error: unknown) =>
      error instanceof RunRequestError && error.code === "unknown_backend",
  );
});

test("requires a backend for a workflow that advertises one", () => {
  assert.throws(
    () => plan({ ...localRun, execution: { workflow: "local" } }),
    (error: unknown) =>
      error instanceof RunRequestError && error.code === "malformed_request",
  );
});

test("rejects remote parameters on a local run", () => {
  assert.throws(
    () =>
      plan({
        ...localRun,
        parameters: {
          weights: "/models/yolo26.onnx",
          kserve_endpoint: "http://127.0.0.1:8000",
        },
      }),
    (error: unknown) =>
      error instanceof RunRequestError && error.code === "unknown_parameter",
  );
});

test("requires weights only for local execution", () => {
  assert.throws(
    () => plan({ ...localRun, parameters: {} }),
    (error: unknown) =>
      error instanceof RunRequestError &&
      error.code === "missing_parameter" &&
      error.field === "weights",
  );

  const remote = plan({
    task: "object_detection",
    model: "yolo26",
    execution: {
      workflow: "client_server",
      protocol: "kserve_v2",
      transport: "http",
    },
    source: { type: "image", paths: ["/fixtures/bus.jpg"] },
    parameters: {
      kserve_endpoint: "http://127.0.0.1:8000",
      kserve_transport: "http",
    },
  });

  assert.deepEqual(remote.args, [
    "--type=yolo26",
    "--kserve_endpoint=http://127.0.0.1:8000",
    "--kserve_transport=http",
    "--source=/fixtures/bus.jpg",
  ]);
  assert.equal(remote.backend, null);
  assert.equal(remote.transport, "http");
});

test("rejects a transport the protocol does not advertise", () => {
  assert.throws(
    () =>
      plan({
        task: "object_detection",
        model: "yolo26",
        execution: {
          workflow: "client_server",
          protocol: "kserve_v2",
          transport: "quic",
        },
        source: { type: "image", paths: ["/fixtures/bus.jpg"] },
        parameters: { kserve_endpoint: "http://127.0.0.1:8000" },
      }),
    (error: unknown) =>
      error instanceof RunRequestError && error.code === "unknown_transport",
  );
});

test("enforces the advertised source count and type", () => {
  assert.throws(
    () =>
      plan({
        task: "optical_flow",
        model: "raft",
        execution: { workflow: "local", backend: "onnx_runtime" },
        source: { type: "image", paths: ["/a.png"] },
        parameters: { weights: "/models/raft.onnx" },
      }),
    (error: unknown) =>
      error instanceof RunRequestError && error.code === "invalid_source",
  );

  assert.throws(
    () => plan({ ...localRun, source: { type: "audio", paths: ["/a.wav"] } }),
    (error: unknown) =>
      error instanceof RunRequestError && error.code === "unknown_source_type",
  );
});

test("refuses a source path that would split into two sources", () => {
  assert.throws(
    () => plan({ ...localRun, source: { type: "image", paths: ["/a,b.png"] } }),
    (error: unknown) =>
      error instanceof RunRequestError && error.code === "invalid_source",
  );
});

test("validates parameter values against the contract", () => {
  assert.throws(
    () =>
      plan({
        ...localRun,
        parameters: { weights: "/models/yolo26.onnx", min_confidence: "1.5" },
      }),
    (error: unknown) =>
      error instanceof RunRequestError && error.code === "invalid_parameter",
  );

  assert.throws(
    () =>
      plan({
        ...localRun,
        parameters: { weights: "/models/yolo26.onnx", iterations: "many" },
      }),
    (error: unknown) =>
      error instanceof RunRequestError && error.code === "invalid_parameter",
  );

  assert.throws(
    () =>
      plan({
        task: "object_detection",
        model: "yolo26",
        execution: {
          workflow: "client_server",
          protocol: "kserve_v2",
          transport: "http",
        },
        source: { type: "image", paths: ["/fixtures/bus.jpg"] },
        parameters: {
          kserve_endpoint: "http://127.0.0.1:8000",
          kserve_transport: "quic",
        },
      }),
    (error: unknown) =>
      error instanceof RunRequestError && error.code === "invalid_parameter",
  );
});

test("rejects an unknown task", () => {
  assert.throws(
    () => plan({ ...localRun, task: "segmentation" }),
    (error: unknown) =>
      error instanceof RunRequestError && error.code === "unknown_task",
  );
});
