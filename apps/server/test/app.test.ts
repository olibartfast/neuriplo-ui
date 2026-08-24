import assert from "node:assert/strict";
import { test } from "node:test";
import { buildServer } from "../src/app.js";
import {
  CapabilitiesDiscoveryError,
  type NeuriploCapabilities,
} from "../src/capabilities.js";

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
