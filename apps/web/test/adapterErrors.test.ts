import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { CapabilitiesFetchError, fetchCapabilities } from "../src/contract.js";
import { DirectoryListingError, listDirectory } from "../src/files.js";
import { RunFailedError, startRun } from "../src/run.js";
import type { ResolvedSelection } from "../src/selection.js";

/**
 * The three fetches the UI makes, at the boundary where they fail.
 *
 * The browser suite drives the happy path of each of these. What it does not
 * reach is the mapping underneath: a failed response carries an error the UI
 * shows verbatim, and a response with no usable body at all still has to
 * produce something a person can act on rather than "undefined". That mapping
 * is duplicated across all three modules, so it is tested across all three.
 */

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

/** Stands in for a Response without pulling in a DOM implementation. */
function respond(status: number, body: unknown, parses = true): void {
  globalThis.fetch = (async () =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (!parses) throw new SyntaxError("Unexpected token < in JSON");
        return body;
      },
    }) as unknown as Response) as typeof fetch;
}

function refuse(): void {
  globalThis.fetch = (async () => {
    throw new TypeError("Failed to fetch");
  }) as typeof fetch;
}

const selection = {
  selection: {
    taskId: "object_detection",
    modelId: "yolo26",
    workflowId: "local",
    backend: "onnx_runtime",
    protocolId: null,
    transport: null,
    sourceType: "image",
    sources: ["/tmp/a.png"],
    parameters: {},
  },
} as unknown as ResolvedSelection;

test("passes the adapter's own error code and message through", async () => {
  respond(400, {
    error: { code: "invalid_source", message: "Source is outside the root." },
  });

  const failure = await startRun(selection).then(
    () => null,
    (error: unknown) => error,
  );

  assert.ok(failure instanceof RunFailedError);
  // The adapter's wording is what the user sees: it knows why it refused, and
  // restating it here would be a second, staler explanation.
  assert.equal(failure.code, "invalid_source");
  assert.equal(failure.message, "Source is outside the root.");
});

test("keeps the field a rejection blamed, so the form can point at it", async () => {
  respond(422, {
    error: {
      code: "missing_parameter",
      message: "Weights are required.",
      field: "weights",
    },
  });

  const failure = await startRun(selection).then(
    () => null,
    (error: unknown) => error,
  );

  assert.ok(failure instanceof RunFailedError);
  assert.equal(failure.field, "weights");
});

test("falls back to the status when a failure carries no error body", async () => {
  // A proxy or a crash can return a failing status with no adapter payload at
  // all. Reporting "undefined" would tell the user nothing; the status is at
  // least true.
  for (const body of [null, {}, { error: {} }, "gateway timeout"]) {
    respond(504, body);
    const failure = await fetchCapabilities().then(
      () => null,
      (error: unknown) => error,
    );

    assert.ok(failure instanceof CapabilitiesFetchError);
    assert.equal(failure.code, "504");
    assert.equal(failure.message, "Capability discovery failed.");
  }
});

test("survives a failure whose body is not JSON at all", async () => {
  respond(502, null, false);

  const failure = await listDirectory("/tmp").then(
    () => null,
    (error: unknown) => error,
  );

  assert.ok(failure instanceof DirectoryListingError);
  assert.equal(failure.code, "502");
});

test("reports an unreachable adapter as unreachable, not as a run that failed", async () => {
  refuse();

  const attempts = [
    { of: () => fetchCapabilities(), type: CapabilitiesFetchError },
    { of: () => startRun(selection), type: RunFailedError },
    { of: () => listDirectory(), type: DirectoryListingError },
  ];

  // All three say the same thing, because it is the same thing: the adapter
  // was never reached, so nothing ran and nothing was refused.
  for (const attempt of attempts) {
    const failure = await attempt.of().then(
      () => null,
      (error: unknown) => error,
    );

    assert.ok(failure instanceof attempt.type);
    assert.equal(failure.code, "unreachable");
    assert.match(failure.message, /Could not reach the local Neuriplo adapter/);
  }
});

test("returns the payload untouched when the adapter succeeds", async () => {
  respond(200, { schema_version: 2, producer: { version: "0.9.1" } });

  const capabilities = await fetchCapabilities();
  // Schema version 2 is representable, which the type asserted was impossible
  // until the type gate went in.
  assert.equal(capabilities.schema_version, 2);
});
