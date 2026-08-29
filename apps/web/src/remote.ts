// What a remote KServe server says about itself. The adapter does the fetching,
// because it is the process that can reach the server and the one that holds
// the allowlist confining where it may look.

import type { CapabilityWorkflow, NeuriploCapabilities } from "./contract.js";

export type RemoteTensor = {
  name: string;
  datatype: string | null;
  shape: number[] | null;
};

export type RemoteMetadata = {
  endpoint: string;
  server: { name: string | null; version: string | null; extensions: string[] };
  model: {
    name: string | null;
    versions: string[];
    platform: string | null;
    inputs: RemoteTensor[];
    outputs: RemoteTensor[];
  } | null;
};

export class RemoteMetadataError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "RemoteMetadataError";
  }
}

export async function fetchRemoteMetadata(
  endpoint: string,
  model: string | null,
  version: string | null,
  signal?: AbortSignal,
): Promise<RemoteMetadata> {
  const query = new URLSearchParams({ endpoint });
  if (model?.trim()) query.set("model", model.trim());
  if (version?.trim()) query.set("version", version.trim());

  let response: Response;
  try {
    response = await fetch(`/api/remote/metadata?${query}`, { signal });
  } catch {
    throw new RemoteMetadataError(
      "unreachable",
      "Could not reach the local Neuriplo adapter.",
    );
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as { error: { code?: string; message?: string } }).error
        : null;
    throw new RemoteMetadataError(
      error?.code ?? String(response.status),
      error?.message ?? "The server could not be described.",
    );
  }

  return payload as RemoteMetadata;
}

export type RemoteParameters = {
  endpoint: string | null;
  model: string | null;
  version: string | null;
};

/**
 * Which of the workflow's parameters address the remote server.
 *
 * The endpoint is found by its advertised type — exactly one client-server
 * parameter is a `url` — and needs no guesswork. The model name and version do:
 * nothing in the contract marks a parameter as the one naming the remote model,
 * so they are matched by their advertised ids.
 *
 * That is the same contract gap Phase 3 recorded for pairing a protocol's
 * transports with the parameter that becomes the CLI flag. Advertising the
 * parameter ids on the protocol would remove the guessing here too; until then
 * a build whose ids do not match simply gets server metadata without model
 * metadata, which is a smaller loss than hardcoding a producer's naming.
 */
export function remoteParameters(
  capabilities: NeuriploCapabilities,
  workflow: CapabilityWorkflow,
): RemoteParameters {
  const ids = [...workflow.parameters.required, ...workflow.parameters.optional];
  const typed = (id: string) => capabilities.parameters[id]?.value_type;

  const version =
    ids.find((id) => typed(id) === "string" && /version/i.test(id)) ?? null;

  return {
    endpoint: ids.find((id) => typed(id) === "url") ?? null,
    model:
      ids.find(
        (id) => typed(id) === "string" && /model/i.test(id) && id !== version,
      ) ?? null,
    version,
  };
}
