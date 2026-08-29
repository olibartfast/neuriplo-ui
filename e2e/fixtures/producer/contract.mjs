/**
 * The contract the fixture producer advertises.
 *
 * It is deliberately small and structurally complete rather than a copy of the
 * real catalog: it carries one task per structural family the UI branches on
 * (single-source image, multi-source, video, prompt-driven) and both execution
 * workflows, and nothing else. A real `neuriplo-infer` advertises far more; the
 * suite reads whatever it is given, so the difference never reaches a test.
 *
 * `producer.version` ends in `-fixture`. That suffix is the only thing that
 * distinguishes this from a real binary, to the adapter, to the UI, and to the
 * few tests that need values only a fixture can guarantee.
 */

export const RUN_REPORT = {
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

export const CAPABILITIES = {
  schema_version: 2,
  producer: { name: "neuriplo-infer", version: "0.9.1-fixture" },
  diagnostics: { run_report: RUN_REPORT },
  execution: {
    workflows: [
      {
        id: "local",
        // Two backends so backend switching has something to switch between.
        backends: ["opencv_dnn", "onnx_runtime"],
        protocols: [],
        parameters: { required: ["weights"], optional: ["batch"] },
      },
      {
        id: "client_server",
        backends: [],
        protocols: [{ id: "kserve_v2", transports: ["http", "grpc"] }],
        parameters: {
          required: ["kserve_endpoint"],
          optional: ["kserve_transport", "kserve_model_name"],
        },
      },
    ],
  },
  source_types: [
    { id: "image", input: "file_path" },
    { id: "video", input: "file_path" },
  ],
  parameters: {
    batch: { cli_flag: "batch", value_type: "integer", default: 1, minimum: 1 },
    kserve_endpoint: { cli_flag: "kserve_endpoint", value_type: "url" },
    kserve_model_name: { cli_flag: "kserve_model_name", value_type: "string" },
    kserve_transport: {
      cli_flag: "kserve_transport",
      value_type: "enum",
      default: "http",
      values: ["http", "grpc"],
    },
    max_frames: { cli_flag: "max_frames", value_type: "integer", minimum: 0 },
    min_confidence: {
      cli_flag: "min_confidence",
      value_type: "number",
      default: 0.25,
      minimum: 0,
      maximum: 1,
    },
    output_format: {
      cli_flag: "output_format",
      value_type: "enum",
      values: ["text", "json"],
    },
    prompt: { cli_flag: "prompt", value_type: "string" },
    weights: { cli_flag: "weights", value_type: "path" },
  },
  tasks: [
    {
      id: "object_detection",
      models: [
        {
          id: "yolo26",
          aliases: ["yolo"],
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
      sources: { types: ["image"], min_items: 1, max_items: 1 },
      parameters: {
        required: [],
        optional: ["min_confidence", "output_format"],
      },
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
      // Two frames minimum and no upper bound, which is what generates source
      // slots and the "add source" control.
      sources: { types: ["image"], min_items: 2, max_items: -1 },
      parameters: { required: [], optional: ["output_format"] },
    },
    {
      id: "video_classification",
      models: [
        {
          id: "videomae",
          aliases: [],
          patterns: [],
          parameters: { required: [], optional: [] },
        },
      ],
      sources: { types: ["video"], min_items: 1, max_items: 1 },
      parameters: {
        required: [],
        optional: ["max_frames", "output_format"],
      },
    },
    {
      id: "open_vocabulary_detection",
      models: [
        {
          id: "owlvit",
          aliases: [],
          patterns: [],
          parameters: { required: ["prompt"], optional: [] },
        },
      ],
      sources: { types: ["image"], min_items: 1, max_items: 1 },
      parameters: {
        required: [],
        optional: ["min_confidence", "output_format"],
      },
    },
  ],
};

/**
 * Resolves a model selector the way the producer does: exact ids and aliases
 * first, then the most specific wildcard family, ignoring case, spaces, dashes,
 * and underscores. The adapter has already accepted the selector by the time it
 * reaches the binary; this is how the binary decides which task it belongs to.
 */
export function resolveSelector(selector) {
  const normalized = normalize(selector);
  if (!normalized) return null;

  for (const task of CAPABILITIES.tasks) {
    for (const model of task.models) {
      const names = [model.id, ...model.aliases].map(normalize);
      if (names.includes(normalized)) return { task, model };
    }
  }

  let best = null;
  for (const task of CAPABILITIES.tasks) {
    for (const model of task.models) {
      for (const pattern of model.patterns) {
        if (!matchesPattern(normalized, normalize(pattern))) continue;
        const specificity = pattern.replaceAll("*", "").length;
        if (!best || specificity > best.specificity) {
          best = { task, model, specificity };
        }
      }
    }
  }

  return best ? { task: best.task, model: best.model } : null;
}

function matchesPattern(value, pattern) {
  const expression = pattern
    .split("*")
    .map((part) => part.replaceAll(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(value);
}

function normalize(value) {
  return value.toLowerCase().replaceAll(/[\s_-]/g, "");
}
