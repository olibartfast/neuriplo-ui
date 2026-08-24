import { execFile } from "node:child_process";
import { promisify } from "node:util";

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

export type CapabilityWorkflow = {
  id: "local" | "client_server";
  backends: string[];
  protocols: Array<{ id: string; transports: string[] }>;
  parameters: CapabilityParameterSelection;
};

export type NeuriploCapabilities = {
  schema_version: 1;
  producer: { name: "neuriplo-infer"; version: string };
  execution: { workflows: CapabilityWorkflow[] };
  source_types: Array<{ id: string; input: string }>;
  parameters: Record<string, { cli_flag: string; value_type: string }>;
  tasks: CapabilityTask[];
};

export type CapabilitiesErrorCode =
  | "not_configured"
  | "execution_failed"
  | "invalid_response"
  | "unsupported_schema";

export class CapabilitiesDiscoveryError extends Error {
  constructor(
    readonly code: CapabilitiesErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CapabilitiesDiscoveryError";
  }
}

export type CapabilitiesCommandRunner = (
  binaryPath: string,
) => Promise<{ stdout: string; stderr: string }>;

const execFileAsync = promisify(execFile);

export async function runCapabilitiesCommand(
  binaryPath: string,
): Promise<{ stdout: string; stderr: string }> {
  const result = await execFileAsync(binaryPath, ["--capabilities"], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024,
    timeout: 10_000,
    windowsHide: true,
  });

  return { stdout: result.stdout, stderr: result.stderr };
}

export async function discoverCapabilities(
  binaryPath = process.env.NEURIPLO_INFER_BIN,
  runCommand: CapabilitiesCommandRunner = runCapabilitiesCommand,
): Promise<NeuriploCapabilities> {
  if (!binaryPath?.trim()) {
    throw new CapabilitiesDiscoveryError(
      "not_configured",
      "NEURIPLO_INFER_BIN is not configured",
    );
  }

  let stdout: string;
  try {
    ({ stdout } = await runCommand(binaryPath));
  } catch (cause) {
    throw new CapabilitiesDiscoveryError(
      "execution_failed",
      "Failed to execute neuriplo-infer --capabilities",
      { cause },
    );
  }

  let payload: unknown;
  try {
    payload = JSON.parse(stdout);
  } catch (cause) {
    throw new CapabilitiesDiscoveryError(
      "invalid_response",
      "neuriplo-infer returned invalid capabilities JSON",
      { cause },
    );
  }

  assertCapabilities(payload);
  return payload;
}

function assertCapabilities(
  value: unknown,
): asserts value is NeuriploCapabilities {
  if (!isRecord(value)) {
    throw invalidResponse("Capabilities response must be an object");
  }
  if (value.schema_version !== 1) {
    throw new CapabilitiesDiscoveryError(
      "unsupported_schema",
      `Unsupported capabilities schema version: ${String(value.schema_version)}`,
    );
  }
  if (
    !isRecord(value.producer) ||
    value.producer.name !== "neuriplo-infer" ||
    typeof value.producer.version !== "string"
  ) {
    throw invalidResponse("Capabilities producer is invalid");
  }
  if (
    !isRecord(value.execution) ||
    !Array.isArray(value.execution.workflows) ||
    value.execution.workflows.length === 0 ||
    !value.execution.workflows.every(isWorkflow)
  ) {
    throw invalidResponse("Capabilities workflows are invalid");
  }
  if (
    !Array.isArray(value.source_types) ||
    !value.source_types.every(
      (source) =>
        isRecord(source) &&
        typeof source.id === "string" &&
        typeof source.input === "string",
    )
  ) {
    throw invalidResponse("Capabilities source types are invalid");
  }
  if (!isRecord(value.parameters)) {
    throw invalidResponse("Capabilities parameter catalog is invalid");
  }
  for (const parameter of Object.values(value.parameters)) {
    if (
      !isRecord(parameter) ||
      typeof parameter.cli_flag !== "string" ||
      typeof parameter.value_type !== "string"
    ) {
      throw invalidResponse("Capabilities parameter definition is invalid");
    }
  }
  if (
    !Array.isArray(value.tasks) ||
    value.tasks.length === 0 ||
    !value.tasks.every(isTask)
  ) {
    throw invalidResponse("Capabilities tasks are invalid");
  }

  const parameterIds = new Set(Object.keys(value.parameters));
  for (const workflow of value.execution.workflows) {
    assertParameterReferences(workflow.parameters, parameterIds);
  }
  for (const task of value.tasks) {
    assertParameterReferences(task.parameters, parameterIds);
    for (const model of task.models) {
      assertParameterReferences(model.parameters, parameterIds);
    }
  }
}

function isWorkflow(value: unknown): value is CapabilityWorkflow {
  return (
    isRecord(value) &&
    (value.id === "local" || value.id === "client_server") &&
    isStringArray(value.backends) &&
    Array.isArray(value.protocols) &&
    value.protocols.every(
      (protocol) =>
        isRecord(protocol) &&
        typeof protocol.id === "string" &&
        isStringArray(protocol.transports),
    ) &&
    isParameterSelection(value.parameters)
  );
}

function isTask(value: unknown): value is CapabilityTask {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    Array.isArray(value.models) &&
    value.models.length > 0 &&
    value.models.every(isModel) &&
    isRecord(value.sources) &&
    isStringArray(value.sources.types) &&
    typeof value.sources.min_items === "number" &&
    typeof value.sources.max_items === "number" &&
    isParameterSelection(value.parameters)
  );
}

function isModel(value: unknown): value is CapabilityModel {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    isStringArray(value.aliases) &&
    isStringArray(value.patterns) &&
    isParameterSelection(value.parameters)
  );
}

function isParameterSelection(
  value: unknown,
): value is CapabilityParameterSelection {
  return (
    isRecord(value) &&
    isStringArray(value.required) &&
    isStringArray(value.optional)
  );
}

function assertParameterReferences(
  selection: CapabilityParameterSelection,
  parameterIds: Set<string>,
): void {
  for (const parameter of [...selection.required, ...selection.optional]) {
    if (!parameterIds.has(parameter)) {
      throw invalidResponse(
        `Capabilities reference unknown parameter: ${parameter}`,
      );
    }
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function invalidResponse(message: string): CapabilitiesDiscoveryError {
  return new CapabilitiesDiscoveryError("invalid_response", message);
}
