import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  CapabilityWorkflow,
  NeuriploCapabilities,
} from "../src/contract.js";
import { remoteParameters } from "../src/remote.js";

const capabilities = {
  parameters: {
    kserve_endpoint: { cli_flag: "kserve_endpoint", value_type: "url" },
    kserve_model_name: { cli_flag: "kserve_model_name", value_type: "string" },
    kserve_model_version: {
      cli_flag: "kserve_model_version",
      value_type: "string",
    },
    kserve_transport: {
      cli_flag: "kserve_transport",
      value_type: "enum",
      values: ["http"],
    },
    weights: { cli_flag: "weights", value_type: "path" },
  },
} as unknown as NeuriploCapabilities;

function workflow(
  required: string[],
  optional: string[] = [],
): CapabilityWorkflow {
  return {
    id: "client_server",
    backends: [],
    protocols: [{ id: "kserve_v2", transports: ["http"] }],
    parameters: { required, optional },
  };
}

test("finds the endpoint by its advertised type", () => {
  const found = remoteParameters(
    capabilities,
    workflow(["kserve_endpoint"], ["kserve_model_name"]),
  );

  // Exactly one client-server parameter is a url, so this needs no guessing.
  assert.equal(found.endpoint, "kserve_endpoint");
});

test("tells the model name and its version apart", () => {
  const found = remoteParameters(
    capabilities,
    workflow(
      ["kserve_endpoint"],
      ["kserve_model_name", "kserve_model_version"],
    ),
  );

  assert.equal(found.model, "kserve_model_name");
  assert.equal(found.version, "kserve_model_version");
});

test("reports nothing for a workflow that addresses no server", () => {
  const local = {
    id: "local",
    backends: ["onnx_runtime"],
    protocols: [],
    parameters: { required: ["weights"], optional: [] },
  } as CapabilityWorkflow;

  // A local workflow has no endpoint, so the panel never appears for it.
  assert.deepEqual(remoteParameters(capabilities, local), {
    endpoint: null,
    model: null,
    version: null,
  });
});

test("degrades to server metadata when no model parameter is advertised", () => {
  const found = remoteParameters(capabilities, workflow(["kserve_endpoint"]));

  // A build whose ids do not match loses model metadata and keeps the rest,
  // which is a smaller loss than hardcoding a producer's parameter naming.
  assert.equal(found.endpoint, "kserve_endpoint");
  assert.equal(found.model, null);
  assert.equal(found.version, null);
});
