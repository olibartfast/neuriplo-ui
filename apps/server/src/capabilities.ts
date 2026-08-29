import { execFile } from "node:child_process";
import { promisify } from "node:util";

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

export type CapabilityWorkflow = {
  id: "local" | "client_server";
  backends: string[];
  protocols: CapabilityProtocol[];
  parameters: CapabilityParameterSelection;
};

/**
 * Where a run leaves its machine-readable diagnostics. The producer advertises
 * the path rather than the adapter assuming one, so a build that does not
 * publish a report simply omits the section and nothing downstream changes.
 */
export type CapabilityRunReport = {
  schema_version: number;
  /** Relative to the working directory a run executes in. */
  path: string;
  stages: string[];
};

/**
 * Version 1 has no diagnostics section; version 2 added it. Both are accepted
 * because the difference is exactly what this adapter already treats as
 * optional: an older binary publishes no run report and the run response then
 * carries no metrics.
 */
export type CapabilitiesSchemaVersion = 1 | 2;

export type NeuriploCapabilities = {
  schema_version: CapabilitiesSchemaVersion;
  producer: { name: "neuriplo-infer"; version: string };
  diagnostics?: { run_report?: CapabilityRunReport };
  execution: { workflows: CapabilityWorkflow[] };
  source_types: Array<{ id: string; input: string }>;
  parameters: Record<string, CapabilityParameter>;
  tasks: CapabilityTask[];
};

/** The advertised run report, or null when this build publishes none. */
export function runReportContract(
  capabilities: NeuriploCapabilities,
): CapabilityRunReport | null {
  return capabilities.diagnostics?.run_report ?? null;
}

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
  if (value.schema_version !== 1 && value.schema_version !== 2) {
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
  // Diagnostics are optional: an older binary advertises none, and the run
  // response then simply carries no metrics and no failure stage.
  if (value.diagnostics !== undefined) {
    if (!isRecord(value.diagnostics)) {
      throw invalidResponse("Capabilities diagnostics are invalid");
    }
    if (
      value.diagnostics.run_report !== undefined &&
      !isRunReport(value.diagnostics.run_report)
    ) {
      throw invalidResponse("Capabilities run report is invalid");
    }
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

function isRunReport(value: unknown): value is CapabilityRunReport {
  return (
    isRecord(value) &&
    typeof value.schema_version === "number" &&
    typeof value.path === "string" &&
    value.path.length > 0 &&
    // An absolute or climbing path would let the producer point the adapter
    // outside the run directory it is allowed to read.
    !value.path.startsWith("/") &&
    !value.path.split("/").includes("..") &&
    isStringArray(value.stages)
  );
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
