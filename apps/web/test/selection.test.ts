import assert from "node:assert/strict";
import { test } from "node:test";
import type { NeuriploCapabilities } from "../src/contract.js";
import { missingRequirements, resolveSelection } from "../src/selection.js";

const capabilities: NeuriploCapabilities = {
  schema_version: 1,
  producer: { name: "neuriplo-infer", version: "0.9.1" },
  execution: {
    workflows: [
      {
        id: "local",
        backends: ["opencv_dnn", "onnx_runtime"],
        protocols: [],
        parameters: { required: ["weights"], optional: ["use_gpu"] },
      },
      {
        id: "client_server",
        backends: [],
        protocols: [{ id: "kserve_v2", transports: ["http", "grpc"] }],
        parameters: { required: ["kserve_endpoint"], optional: [] },
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
    kserve_endpoint: { cli_flag: "kserve_endpoint", value_type: "url" },
    text_prompts: {
      cli_flag: "text_prompts",
      value_type: "string_list",
      separator: ",",
    },
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
        {
          id: "rtdetr",
          aliases: [],
          patterns: [],
          parameters: { required: [], optional: [] },
        },
      ],
      sources: { types: ["image", "video"], min_items: 1, max_items: 1 },
      parameters: { required: [], optional: [] },
    },
    {
      id: "open_vocabulary_detection",
      models: [
        {
          id: "owlv2",
          aliases: [],
          patterns: [],
          parameters: { required: ["text_prompts"], optional: [] },
        },
      ],
      sources: { types: ["image"], min_items: 1, max_items: 1 },
      parameters: { required: [], optional: [] },
    },
  ],
};

test("defaults to the first advertised option of every dimension", () => {
  const { selection } = resolveSelection(capabilities);

  assert.equal(selection.taskId, "object_detection");
  assert.equal(selection.modelId, "yolo26");
  assert.equal(selection.workflowId, "local");
  assert.equal(selection.backend, "opencv_dnn");
  assert.equal(selection.sourceType, "image");
  assert.equal(selection.protocolId, null);
  assert.equal(selection.transport, null);
});

test("drops a model that the newly selected task does not offer", () => {
  const { selection } = resolveSelection(capabilities, {
    taskId: "open_vocabulary_detection",
    modelId: "yolo26",
  });

  assert.equal(selection.modelId, "owlv2");
});

test("drops a source type the selected task does not support", () => {
  const { selection } = resolveSelection(capabilities, {
    taskId: "open_vocabulary_detection",
    sourceType: "video",
  });

  assert.equal(selection.sourceType, "image");
});

test("exposes no local backend for the client-server workflow", () => {
  const { selection, protocol } = resolveSelection(capabilities, {
    workflowId: "client_server",
    backend: "onnx_runtime",
  });

  assert.equal(selection.backend, null);
  assert.equal(protocol?.id, "kserve_v2");
  assert.equal(selection.transport, "http");
});

test("keeps a transport only while its protocol advertises it", () => {
  const { selection } = resolveSelection(capabilities, {
    workflowId: "client_server",
    transport: "grpc",
  });

  assert.equal(selection.transport, "grpc");
});

test("collects parameters from the workflow, task, and model", () => {
  const { parameters } = resolveSelection(capabilities, {
    taskId: "open_vocabulary_detection",
    workflowId: "local",
  });

  assert.deepEqual(
    parameters.map((entry) => entry.id),
    ["weights", "use_gpu", "text_prompts"],
  );
  assert.deepEqual(
    parameters.filter((entry) => entry.required).map((entry) => entry.id),
    ["weights", "text_prompts"],
  );
});

test("seeds declared defaults and preserves values across changes", () => {
  const first = resolveSelection(capabilities, { workflowId: "local" });
  assert.equal(first.selection.parameters.use_gpu, "false");

  const edited = resolveSelection(capabilities, {
    ...first.selection,
    parameters: { ...first.selection.parameters, weights: "/models/y.onnx" },
  });
  assert.equal(edited.selection.parameters.weights, "/models/y.onnx");

  // Switching to a workflow that does not declare `weights` drops the value.
  const switched = resolveSelection(capabilities, {
    ...edited.selection,
    workflowId: "client_server",
  });
  assert.equal(switched.selection.parameters.weights, undefined);
  assert.deepEqual(Object.keys(switched.selection.parameters), [
    "kserve_endpoint",
  ]);
});

test("reports required parameters that are still empty", () => {
  const resolved = resolveSelection(capabilities, {
    workflowId: "client_server",
  });
  assert.deepEqual(missingRequirements(resolved), ["kserve_endpoint"]);

  const filled = resolveSelection(capabilities, {
    ...resolved.selection,
    parameters: { kserve_endpoint: "http://127.0.0.1:8000" },
  });
  assert.deepEqual(missingRequirements(filled), []);
});

test("ignores parameter references missing from the catalog", () => {
  const withUnknown: NeuriploCapabilities = {
    ...capabilities,
    execution: {
      workflows: [
        {
          id: "local",
          backends: ["opencv_dnn"],
          protocols: [],
          parameters: { required: ["weights", "not_in_catalog"], optional: [] },
        },
      ],
    },
  };

  const { parameters } = resolveSelection(withUnknown);
  assert.deepEqual(
    parameters.map((entry) => entry.id),
    ["weights"],
  );
});
