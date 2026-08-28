import assert from "node:assert/strict";
import { test } from "node:test";
import type { NeuriploCapabilities } from "../src/contract.js";
import {
  canAddSource,
  canRemoveSource,
  filledSources,
  findModelForSelector,
  findTaskModelForSelector,
  missingRequirements,
  modelSelectorPatterns,
  modelSelectorSuggestions,
  resolveSelection,
} from "../src/selection.js";
import { buildRunRequest } from "../src/run.js";

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
          aliases: ["yolov10"],
          patterns: ["yolo*"],
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

test("resolves advertised aliases and wildcard selectors", () => {
  const alias = resolveSelection(capabilities, {
    taskId: "object_detection",
    modelId: "YOLO-V10",
  });
  assert.equal(alias.selection.modelId, "YOLO-V10");
  assert.equal(alias.model.id, "yolo26");

  const wildcard = resolveSelection(capabilities, {
    taskId: "object_detection",
    modelId: "yolo_v8",
  });
  assert.equal(wildcard.selection.modelId, "yolo_v8");
  assert.equal(wildcard.model.id, "yolo26");
});

test("exposes concrete suggestions separately from wildcard families", () => {
  const models = capabilities.tasks[0].models;

  assert.deepEqual(modelSelectorSuggestions(models), [
    "yolo26",
    "yolov10",
    "rtdetr",
  ]);
  assert.deepEqual(modelSelectorPatterns(models), ["yolo*"]);
  assert.equal(findModelForSelector(models, " YOLO-11 ")?.id, "yolo26");
  assert.equal(findModelForSelector(models, "owlv2"), undefined);
});

test("routes overlapping wildcard families to the most specific task", () => {
  const tasks: NeuriploCapabilities["tasks"] = [
    capabilities.tasks[0],
    {
      id: "instance_segmentation",
      models: [
        {
          id: "yoloseg",
          aliases: [],
          patterns: ["yolo*seg*"],
          parameters: { required: [], optional: [] },
        },
      ],
      sources: { types: ["image"], min_items: 1, max_items: 1 },
      parameters: { required: [], optional: [] },
    },
  ];

  assert.equal(
    findTaskModelForSelector(tasks, "yolo26-seg")?.task.id,
    "instance_segmentation",
  );
  assert.equal(
    findTaskModelForSelector(tasks, "yolo11")?.task.id,
    "object_detection",
  );
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

test("reports the source and required parameters that are still empty", () => {
  const resolved = resolveSelection(capabilities, {
    workflowId: "client_server",
  });
  assert.deepEqual(missingRequirements(resolved), ["source", "kserve_endpoint"]);

  const filled = resolveSelection(capabilities, {
    ...resolved.selection,
    sources: ["/fixtures/bus.jpg"],
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

test("offers one source slot per source the task accepts", () => {
  const single = resolveSelection(capabilities, {});
  assert.deepEqual(single.selection.sources, [""]);
  assert.equal(canAddSource(single.task, single.selection.sources), false);
  assert.equal(canRemoveSource(single.task, single.selection.sources), false);

  // A second path cannot survive a task that advertises max_items: 1.
  const clamped = resolveSelection(capabilities, {
    sources: ["/a.png", "/b.png"],
  });
  assert.deepEqual(clamped.selection.sources, ["/a.png"]);
});

test("keeps the minimum number of slots for a multi-source task", () => {
  const flow: NeuriploCapabilities = {
    ...capabilities,
    tasks: [
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

  const resolved = resolveSelection(flow, {});
  assert.deepEqual(resolved.selection.sources, ["", ""]);
  assert.equal(canAddSource(resolved.task, resolved.selection.sources), true);
  assert.equal(
    canRemoveSource(resolved.task, resolved.selection.sources),
    false,
  );
  assert.deepEqual(missingRequirements(resolved), ["source", "weights"]);

  const partial = resolveSelection(flow, { sources: ["/a.png", ""] });
  assert.deepEqual(missingRequirements(partial), ["source", "weights"]);

  const complete = resolveSelection(flow, {
    sources: ["/a.png", "/b.png", "/c.png"],
    parameters: { weights: "/models/raft.onnx" },
  });
  assert.deepEqual(filledSources(complete), ["/a.png", "/b.png", "/c.png"]);
  assert.deepEqual(missingRequirements(complete), []);
  assert.equal(canRemoveSource(complete.task, complete.selection.sources), true);
});

test("binds the transport control to the parameter that carries it", () => {
  const withTransportParameter: NeuriploCapabilities = {
    ...capabilities,
    parameters: {
      ...capabilities.parameters,
      kserve_transport: {
        cli_flag: "kserve_transport",
        value_type: "enum",
        default: "grpc",
        values: ["http", "grpc"],
      },
    },
    execution: {
      workflows: [
        capabilities.execution.workflows[0],
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
  };

  // The advertised default wins over "first transport advertised".
  const resolved = resolveSelection(withTransportParameter, {
    workflowId: "client_server",
  });
  assert.equal(resolved.selection.transport, "grpc");
  assert.equal(resolved.selection.parameters.kserve_transport, "grpc");

  // The parameter is not rendered twice: the transport control owns it.
  assert.deepEqual(
    resolved.parameters.map((entry) => entry.id),
    ["kserve_endpoint"],
  );

  const switched = resolveSelection(withTransportParameter, {
    ...resolved.selection,
    transport: "http",
  });
  assert.equal(switched.selection.parameters.kserve_transport, "http");
});

test("builds a run request from the resolved selection", () => {
  const resolved = resolveSelection(capabilities, {
    workflowId: "local",
    backend: "onnx_runtime",
    sources: ["  /fixtures/bus.jpg  "],
    parameters: { weights: "/models/y.onnx", use_gpu: "false" },
  });

  assert.deepEqual(buildRunRequest(resolved), {
    task: "object_detection",
    model: "yolo26",
    execution: {
      workflow: "local",
      backend: "onnx_runtime",
      protocol: null,
      transport: null,
    },
    source: { type: "image", paths: ["/fixtures/bus.jpg"] },
    parameters: { weights: "/models/y.onnx", use_gpu: "false" },
  });
});

test("omits untouched optional parameters from the run request", () => {
  const resolved = resolveSelection(capabilities, {
    workflowId: "client_server",
    sources: ["/fixtures/bus.jpg"],
    parameters: { kserve_endpoint: "http://127.0.0.1:8000" },
  });

  assert.deepEqual(buildRunRequest(resolved).parameters, {
    kserve_endpoint: "http://127.0.0.1:8000",
  });
});
