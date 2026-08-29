#!/usr/bin/env node
/**
 * A KServe V2 metadata responder, and nothing more.
 *
 * The adapter's remote lookup reads `/v2` and `/v2/models/<name>`, so that is
 * exactly what this answers. It serves no inference: proving the *serving*
 * half of client-server execution needs `neuriplo-kserve-runtime`, and this
 * stands in only for the metadata path the UI displays.
 *
 * Listens on loopback so it is reachable by the adapter's default allowlist
 * and by nothing else. Prints the URL it bound on stdout.
 */

import { createServer } from "node:http";

const SERVER = {
  name: "neuriplo-kserve-runtime-fixture",
  version: "0.1.0-fixture",
  extensions: ["model_repository", "binary_tensor_data"],
};

const MODEL = {
  name: "yolo26",
  versions: ["1", "2"],
  platform: "neuriplo_fixture",
  inputs: [{ name: "images", datatype: "FP32", shape: [1, 3, 640, 640] }],
  outputs: [{ name: "output0", datatype: "FP32", shape: [1, 84, 8400] }],
};

const port = Number(process.argv[2] ?? 0);

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const send = (status, payload) => {
    const body = JSON.stringify(payload);
    response.writeHead(status, {
      "content-type": "application/json",
      "content-length": Buffer.byteLength(body),
    });
    response.end(body);
  };

  if (url.pathname === "/v2") return send(200, SERVER);

  const model = /^\/v2\/models\/([^/]+)(?:\/versions\/([^/]+))?$/.exec(
    url.pathname,
  );
  if (model) {
    // Only the model it actually serves; anything else is a 404, which the
    // adapter treats as "the server does not describe this model".
    return decodeURIComponent(model[1]) === MODEL.name
      ? send(200, {
          ...MODEL,
          versions: model[2] ? [model[2]] : MODEL.versions,
        })
      : send(404, { error: "Model not found" });
  }

  send(404, { error: "Not found" });
});

server.listen(port, "127.0.0.1", () => {
  const address = server.address();
  process.stdout.write(`http://127.0.0.1:${address.port}\n`);
});
