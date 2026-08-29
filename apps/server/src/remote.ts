/**
 * Asking a KServe V2 server what it is.
 *
 * This is the only place the adapter fetches a URL the browser supplied, and
 * that makes it a server-side request forgery surface: the adapter runs on the
 * operator's machine and can reach hosts the browser cannot. So the endpoint is
 * confined the way source paths already are — an allowlist, checked before any
 * connection is opened — and the refusal names the variable rather than
 * reporting what was or was not reachable.
 *
 * The default allowlist is loopback, because the adapter itself binds loopback
 * and a runtime on the same machine is the ordinary case. Anything else has to
 * be named. Host allowlisting does not survive a hostname that resolves to an
 * address the operator did not intend, which is a limit worth stating rather
 * than papering over: the guarantee here is "only hosts you named", not "only
 * hosts you named, whatever DNS says".
 */

export type RemoteTensor = {
  name: string;
  datatype: string | null;
  shape: number[] | null;
};

export type RemoteMetadata = {
  endpoint: string;
  server: { name: string | null; version: string | null; extensions: string[] };
  /** Null when no model was named, or the server knows nothing about it. */
  model: {
    name: string | null;
    versions: string[];
    platform: string | null;
    inputs: RemoteTensor[];
    outputs: RemoteTensor[];
  } | null;
};

export type RemoteErrorCode =
  | "invalid_endpoint"
  | "forbidden_endpoint"
  | "unreachable"
  | "invalid_response";

export class RemoteMetadataError extends Error {
  constructor(
    readonly code: RemoteErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RemoteMetadataError";
  }
}

export type RemoteOptions = {
  /** Defaults to `NEURIPLO_UI_REMOTE_ALLOW`, then to loopback only. */
  allow?: string;
  timeoutMs?: number;
  maxBytes?: number;
  fetchImpl?: typeof fetch;
};

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_BYTES = 256 * 1024;
const LOOPBACK = ["127.0.0.1", "::1", "localhost"];

/** Hosts an endpoint may address: the allowlist, or loopback when unset. */
export function allowedHosts(options: RemoteOptions = {}): string[] {
  const configured = options.allow ?? process.env.NEURIPLO_UI_REMOTE_ALLOW;
  const entries = (configured ?? "")
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
  return entries.length > 0 ? entries : LOOPBACK;
}

/**
 * Validates an endpoint against the allowlist without contacting anything.
 *
 * An allowlist entry is either a bare host, which matches any port, or
 * `host:port`, which matches only that one.
 */
export function assertEndpointAllowed(
  endpoint: string,
  options: RemoteOptions = {},
): URL {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    throw new RemoteMetadataError(
      "invalid_endpoint",
      "Endpoint is not a valid URL",
    );
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new RemoteMetadataError(
      "invalid_endpoint",
      `Endpoint must be http or https, not ${url.protocol.replace(":", "")}`,
    );
  }
  // Credentials in the URL would be sent to whatever the endpoint names, and
  // nothing about a metadata lookup needs them.
  if (url.username || url.password) {
    throw new RemoteMetadataError(
      "invalid_endpoint",
      "Endpoint must not carry credentials",
    );
  }

  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  const port = url.port || (url.protocol === "https:" ? "443" : "80");
  const allowed = allowedHosts(options).some(
    (entry) => entry === host || entry === `${host}:${port}`,
  );

  if (!allowed) {
    // Deliberately says nothing about what is reachable — only what is
    // permitted, and where to change it.
    throw new RemoteMetadataError(
      "forbidden_endpoint",
      `Endpoint host is not permitted: ${host}. Set NEURIPLO_UI_REMOTE_ALLOW to allow it.`,
    );
  }

  return url;
}

/**
 * Reads server and, when named, model metadata from a KServe V2 endpoint.
 *
 * The model lookup is best-effort: a server that answers `/v2` but knows
 * nothing about the model still describes itself, and the run remains the
 * authority on whether the configuration works.
 */
export async function fetchRemoteMetadata(
  endpoint: string,
  modelName: string | null,
  modelVersion: string | null = null,
  options: RemoteOptions = {},
): Promise<RemoteMetadata> {
  const base = assertEndpointAllowed(endpoint, options);

  const server = await getJson(base, "v2", options);
  if (!isRecord(server)) {
    throw new RemoteMetadataError(
      "invalid_response",
      "Server metadata was not a JSON object",
    );
  }

  let model: RemoteMetadata["model"] = null;
  if (modelName?.trim()) {
    const path = modelVersion?.trim()
      ? `v2/models/${encodeURIComponent(modelName)}/versions/${encodeURIComponent(modelVersion)}`
      : `v2/models/${encodeURIComponent(modelName)}`;
    // A model the server does not publish is not an error about the server.
    const payload = await getJson(base, path, options).catch(() => null);
    if (isRecord(payload)) model = readModel(payload);
  }

  return {
    endpoint: base.toString(),
    server: {
      name: typeof server.name === "string" ? server.name : null,
      version: typeof server.version === "string" ? server.version : null,
      extensions: stringsOf(server.extensions),
    },
    model,
  };
}

function readModel(payload: Record<string, unknown>): RemoteMetadata["model"] {
  return {
    name: typeof payload.name === "string" ? payload.name : null,
    versions: stringsOf(payload.versions),
    platform: typeof payload.platform === "string" ? payload.platform : null,
    inputs: tensorsOf(payload.inputs),
    outputs: tensorsOf(payload.outputs),
  };
}

async function getJson(
  base: URL,
  path: string,
  options: RemoteOptions,
): Promise<unknown> {
  const target = new URL(path, base.pathname.endsWith("/") ? base : `${base}/`);
  const call = options.fetchImpl ?? fetch;
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;

  let response: Response;
  try {
    response = await call(target, {
      method: "GET",
      headers: { accept: "application/json" },
      // A redirect is not followed at all. Re-validating the target against
      // the allowlist would work, but nothing about a metadata endpoint needs
      // to redirect, and refusing is the smaller surface.
      redirect: "error",
      signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULT_TIMEOUT_MS),
    });
  } catch (cause) {
    throw new RemoteMetadataError(
      "unreachable",
      `Could not reach ${target.host}`,
      { cause },
    );
  }

  if (!response.ok) {
    throw new RemoteMetadataError(
      "unreachable",
      `${target.pathname} answered ${response.status}`,
    );
  }

  const text = await readBounded(response, maxBytes);
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw new RemoteMetadataError(
      "invalid_response",
      `${target.pathname} did not return JSON`,
      { cause },
    );
  }
}

/**
 * Reads a response body up to a byte budget.
 *
 * A `content-length` can be absent or wrong, so the budget is enforced while
 * reading rather than trusted from a header: an endpoint that streams forever
 * must not be able to exhaust the adapter.
 */
async function readBounded(response: Response, maxBytes: number): Promise<string> {
  const body = response.body;
  if (!body) return "";

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      size += value.byteLength;
      if (size > maxBytes) {
        throw new RemoteMetadataError(
          "invalid_response",
          `Response exceeded ${maxBytes} bytes`,
        );
      }
      chunks.push(value);
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return Buffer.concat(chunks).toString("utf8");
}

function tensorsOf(value: unknown): RemoteTensor[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isRecord).map((tensor) => ({
    name: typeof tensor.name === "string" ? tensor.name : "",
    datatype: typeof tensor.datatype === "string" ? tensor.datatype : null,
    shape: Array.isArray(tensor.shape)
      ? tensor.shape.filter((item): item is number => typeof item === "number")
      : null,
  }));
}

function stringsOf(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
