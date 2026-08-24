// Shape of the neuriplo-infer capabilities contract (schema_version 1), as
// defined by docs/capabilities.schema.json in neuriplo-infer.
//
// This file describes the *shape* of the contract only. The set of tasks,
// models, backends, protocols, sources, and parameters stays authoritative in
// the compiled binary and must never be mirrored here.

export type ParameterValueType =
  | "boolean"
  | "enum"
  | "integer"
  | "number"
  | "path"
  | "shape_list"
  | "string"
  | "string_list"
  | "url";

export type CapabilityParameter = {
  cli_flag: string;
  value_type: ParameterValueType;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  separator?: string;
  values?: string[];
};

export type CapabilityParameterSelection = {
  required: string[];
  optional: string[];
};

export type CapabilityModel = {
  id: string;
  aliases: string[];
  patterns: string[];
  parameters: CapabilityParameterSelection;
};

export type CapabilityTask = {
  id: string;
  models: CapabilityModel[];
  sources: {
    types: string[];
    min_items: number;
    max_items: number;
  };
  parameters: CapabilityParameterSelection;
};

export type CapabilityProtocol = {
  id: string;
  transports: string[];
};

export type WorkflowId = "local" | "client_server";

export type CapabilityWorkflow = {
  id: WorkflowId;
  backends: string[];
  protocols: CapabilityProtocol[];
  parameters: CapabilityParameterSelection;
};

export type CapabilitySourceType = {
  id: string;
  input: string;
};

export type NeuriploCapabilities = {
  schema_version: 1;
  producer: { name: "neuriplo-infer"; version: string };
  execution: { workflows: CapabilityWorkflow[] };
  source_types: CapabilitySourceType[];
  parameters: Record<string, CapabilityParameter>;
  tasks: CapabilityTask[];
};

export class CapabilitiesFetchError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "CapabilitiesFetchError";
  }
}

export async function fetchCapabilities(
  signal?: AbortSignal,
): Promise<NeuriploCapabilities> {
  let response: Response;
  try {
    response = await fetch("/api/capabilities", { signal });
  } catch (cause) {
    throw new CapabilitiesFetchError(
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
    throw new CapabilitiesFetchError(
      error?.code ?? String(response.status),
      error?.message ?? "Capability discovery failed.",
    );
  }

  return payload as NeuriploCapabilities;
}

/** Humanises a contract id (`object_detection`) for display. */
export function labelFor(id: string): string {
  return id
    .split(/[_-]/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
