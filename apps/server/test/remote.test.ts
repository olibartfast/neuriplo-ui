import assert from "node:assert/strict";
import { test } from "node:test";
import {
  RemoteMetadataError,
  allowedHosts,
  assertEndpointAllowed,
  fetchRemoteMetadata,
} from "../src/remote.js";

const SERVER = {
  name: "neuriplo-kserve-runtime",
  version: "0.1.0",
  extensions: ["model_repository"],
};

const MODEL = {
  name: "yolo26",
  versions: ["1"],
  platform: "neuriplo_onnxruntime",
  inputs: [{ name: "images", datatype: "FP32", shape: [1, 3, 640, 640] }],
  outputs: [{ name: "output0", datatype: "FP32", shape: [1, 84, 8400] }],
};

/** A fetch that answers the KServe paths and records what was asked for. */
function respondWith(
  routes: Record<string, unknown>,
  seen: string[] = [],
): typeof fetch {
  return (async (input: URL | RequestInfo) => {
    const url = new URL(String(input));
    seen.push(url.pathname);
    const payload = routes[url.pathname];
    if (payload === undefined) {
      return new Response("not found", { status: 404 });
    }
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

test("defaults to loopback and takes an explicit allowlist", () => {
  assert.deepEqual(allowedHosts({ allow: "" }), ["127.0.0.1", "::1", "localhost"]);
  assert.deepEqual(allowedHosts({ allow: "gpu-box, 10.0.0.5:8000" }), [
    "gpu-box",
    "10.0.0.5:8000",
  ]);
});

test("permits a loopback endpoint by default", () => {
  const url = assertEndpointAllowed("http://127.0.0.1:8000", { allow: "" });
  assert.equal(url.hostname, "127.0.0.1");
  assert.doesNotThrow(() =>
    assertEndpointAllowed("http://localhost:9000/", { allow: "" }),
  );
});

test("refuses a host nobody allowed", () => {
  // The adapter can reach hosts the browser cannot, so an endpoint outside the
  // allowlist is refused before anything connects.
  assert.throws(
    () => assertEndpointAllowed("http://169.254.169.254/latest/meta-data", { allow: "" }),
    (error: unknown) => {
      assert.ok(error instanceof RemoteMetadataError);
      assert.equal(error.code, "forbidden_endpoint");
      // Names what is permitted and where to change it, never what was
      // reachable.
      assert.match(error.message, /NEURIPLO_UI_REMOTE_ALLOW/);
      return true;
    },
  );
});

test("matches an allowlist entry by host, and by host and port together", () => {
  assert.doesNotThrow(() =>
    assertEndpointAllowed("http://gpu-box:8000", { allow: "gpu-box" }),
  );
  assert.doesNotThrow(() =>
    assertEndpointAllowed("http://gpu-box:8000", { allow: "gpu-box:8000" }),
  );
  // A pinned port does not permit a different one.
  assert.throws(
    () => assertEndpointAllowed("http://gpu-box:9000", { allow: "gpu-box:8000" }),
    /not permitted/,
  );
});

test("refuses anything that is not an http(s) URL", () => {
  for (const endpoint of [
    "file:///etc/passwd",
    "ftp://127.0.0.1/x",
    "not a url",
  ]) {
    assert.throws(
      () => assertEndpointAllowed(endpoint, { allow: "" }),
      (error: unknown) =>
        error instanceof RemoteMetadataError &&
        error.code === "invalid_endpoint",
    );
  }
});

test("refuses credentials in the endpoint", () => {
  assert.throws(
    () => assertEndpointAllowed("http://user:secret@127.0.0.1:8000", { allow: "" }),
    /must not carry credentials/,
  );
});

test("reads server and model metadata", async () => {
  const seen: string[] = [];
  const metadata = await fetchRemoteMetadata("http://127.0.0.1:8000", "yolo26", null, {
    allow: "",
    fetchImpl: respondWith(
      { "/v2": SERVER, "/v2/models/yolo26": MODEL },
      seen,
    ),
  });

  assert.equal(metadata.server.name, "neuriplo-kserve-runtime");
  assert.deepEqual(metadata.server.extensions, ["model_repository"]);
  assert.equal(metadata.model?.platform, "neuriplo_onnxruntime");
  assert.deepEqual(metadata.model?.inputs[0], {
    name: "images",
    datatype: "FP32",
    shape: [1, 3, 640, 640],
  });
  assert.deepEqual(seen, ["/v2", "/v2/models/yolo26"]);
});

test("asks for a pinned version when one is configured", async () => {
  const seen: string[] = [];
  await fetchRemoteMetadata("http://127.0.0.1:8000", "yolo26", "3", {
    allow: "",
    fetchImpl: respondWith(
      { "/v2": SERVER, "/v2/models/yolo26/versions/3": MODEL },
      seen,
    ),
  });

  assert.deepEqual(seen, ["/v2", "/v2/models/yolo26/versions/3"]);
});

test("describes the server even when it does not know the model", async () => {
  const metadata = await fetchRemoteMetadata("http://127.0.0.1:8000", "absent", null, {
    allow: "",
    fetchImpl: respondWith({ "/v2": SERVER }),
  });

  // A model the server does not publish is not an error about the server, and
  // the run stays the authority on whether the configuration works.
  assert.equal(metadata.model, null);
  assert.equal(metadata.server.name, "neuriplo-kserve-runtime");
});

test("skips the model lookup when no model is named", async () => {
  const seen: string[] = [];
  const metadata = await fetchRemoteMetadata("http://127.0.0.1:8000", null, null, {
    allow: "",
    fetchImpl: respondWith({ "/v2": SERVER }, seen),
  });

  assert.deepEqual(seen, ["/v2"]);
  assert.equal(metadata.model, null);
});

test("reports an unreachable server rather than throwing something opaque", async () => {
  await assert.rejects(
    fetchRemoteMetadata("http://127.0.0.1:8000", null, null, {
      allow: "",
      fetchImpl: (async () => {
        throw new Error("ECONNREFUSED");
      }) as unknown as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof RemoteMetadataError && error.code === "unreachable",
  );
});

test("rejects a body that is not JSON", async () => {
  await assert.rejects(
    fetchRemoteMetadata("http://127.0.0.1:8000", null, null, {
      allow: "",
      fetchImpl: (async () =>
        new Response("<html>hello</html>", { status: 200 })) as unknown as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof RemoteMetadataError && error.code === "invalid_response",
  );
});

test("stops reading a body that exceeds the budget", async () => {
  // No content-length, and it never ends: the budget has to be enforced while
  // reading rather than trusted from a header.
  const endless = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.enqueue(new Uint8Array(1024));
    },
  });

  await assert.rejects(
    fetchRemoteMetadata("http://127.0.0.1:8000", null, null, {
      allow: "",
      maxBytes: 4096,
      fetchImpl: (async () =>
        new Response(endless, { status: 200 })) as unknown as typeof fetch,
    }),
    (error: unknown) =>
      error instanceof RemoteMetadataError &&
      error.code === "invalid_response" &&
      /exceeded 4096 bytes/.test(error.message),
  );
});

test("never follows a redirect", async () => {
  let requested: RequestInit | undefined;
  await fetchRemoteMetadata("http://127.0.0.1:8000", null, null, {
    allow: "",
    fetchImpl: (async (_input: unknown, init: RequestInit) => {
      requested = init;
      return new Response(JSON.stringify(SERVER), { status: 200 });
    }) as unknown as typeof fetch,
  });

  // A metadata endpoint has no reason to redirect, and refusing is a smaller
  // surface than re-validating wherever it points.
  assert.equal(requested?.redirect, "error");
});
