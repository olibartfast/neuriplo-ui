import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type {
  CapabilityModel,
  CapabilityParameter,
  CapabilityParameterSelection,
  CapabilityProtocol,
  CapabilityTask,
  CapabilityWorkflow,
  NeuriploCapabilities,
} from "./capabilities.js";

/**
 * Turns a run request into a `neuriplo-infer` argument array.
 *
 * Everything accepted here is checked against the discovered capabilities, so
 * the adapter never keeps a second task/model/backend registry. Model
 * selectors are the one exception: the contract advertises wildcard families
 * precisely because the set is not enumerable, so a selector only has to match
 * an advertised id, alias, or pattern and the binary stays the final authority.
 */

export type RunExecutionRequest = {
  workflow: string;
  backend?: string | null;
  protocol?: string | null;
  transport?: string | null;
};

export type RunSourceRequest = {
  type: string;
  paths?: string[];
};

export type RunRequest = {
  task: string;
  model: string;
  execution: RunExecutionRequest;
  source: RunSourceRequest;
  parameters?: Record<string, string>;
};

export type PlannedRun = {
  task: CapabilityTask;
  model: CapabilityModel;
  /** The selector as requested, which is what `--type` receives. */
  modelSelector: string;
  workflow: CapabilityWorkflow;
  protocol: CapabilityProtocol | null;
  backend: string | null;
  transport: string | null;
  sourceType: string;
  sourcePaths: string[];
  parameters: Record<string, string>;
  args: string[];
};

export type RunRequestErrorCode =
  | "malformed_request"
  | "unknown_task"
  | "unknown_model"
  | "unknown_workflow"
  | "unknown_backend"
  | "unknown_protocol"
  | "unknown_transport"
  | "unknown_source_type"
  | "invalid_source"
  | "unknown_parameter"
  | "missing_parameter"
  | "invalid_parameter";

export class RunRequestError extends Error {
  constructor(
    readonly code: RunRequestErrorCode,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "RunRequestError";
  }
}

/** Resolves a caller-supplied source path to an absolute, existing path. */
export type SourceResolver = (rawPath: string) => string;

export type PlanRunOptions = {
  resolveSource?: SourceResolver;
};

export function planRun(
  capabilities: NeuriploCapabilities,
  body: unknown,
  options: PlanRunOptions = {},
): PlannedRun {
  const resolveSource = options.resolveSource ?? defaultSourceResolver;

  if (!isRecord(body)) {
    throw new RunRequestError(
      "malformed_request",
      "Run request body must be an object",
    );
  }

  const task = requireTask(capabilities, body.task);
  const modelSelector = requireString(body.model, "model").trim();
  const model = resolveModelSelector(task, modelSelector);
  if (!model) {
    throw new RunRequestError(
      "unknown_model",
      `Model selector is not advertised for task ${task.id}: ${modelSelector}`,
      "model",
    );
  }

  const execution = isRecord(body.execution) ? body.execution : undefined;
  if (!execution) {
    throw new RunRequestError(
      "malformed_request",
      "Run request requires an execution object",
      "execution",
    );
  }

  const workflow = requireWorkflow(capabilities, execution.workflow);
  const backend = resolveBackend(workflow, execution.backend);
  const protocol = resolveProtocol(workflow, execution.protocol);
  const transport = resolveTransport(protocol, execution.transport);

  const source = isRecord(body.source) ? body.source : undefined;
  if (!source) {
    throw new RunRequestError(
      "malformed_request",
      "Run request requires a source object",
      "source",
    );
  }
  const sourceType = requireSourceType(task, source.type);
  const sourcePaths = resolveSourcePaths(task, source.paths, resolveSource);

  const active = activeParameters(capabilities, workflow, task, model);
  const parameters = resolveParameters(
    active,
    capabilities.parameters,
    body.parameters,
  );

  return {
    task,
    model,
    modelSelector,
    workflow,
    protocol,
    backend,
    transport,
    sourceType,
    sourcePaths,
    parameters,
    args: buildArguments(
      modelSelector,
      active,
      capabilities.parameters,
      parameters,
      sourcePaths,
    ),
  };
}

/**
 * Argument array for `neuriplo-infer`. The model selector leads, contract
 * parameters follow in the order the contract declares them, and the source
 * comes last, so the same selection always produces the same command.
 */
function buildArguments(
  modelSelector: string,
  active: ActiveParameter[],
  catalog: Record<string, CapabilityParameter>,
  values: Record<string, string>,
  sourcePaths: string[],
): string[] {
  const args = [`--type=${modelSelector}`];

  for (const parameter of active) {
    const value = values[parameter.id];
    if (value === undefined) continue;
    args.push(`--${catalog[parameter.id].cli_flag}=${value}`);
  }

  if (sourcePaths.length > 0) {
    args.push(`--source=${sourcePaths.join(",")}`);
  }

  return args;
}

type ActiveParameter = { id: string; required: boolean };

/** Union of the parameters the workflow, task, and model declare. */
function activeParameters(
  capabilities: NeuriploCapabilities,
  workflow: CapabilityWorkflow,
  task: CapabilityTask,
  model: CapabilityModel,
): ActiveParameter[] {
  const required = new Set<string>();
  const order: string[] = [];

  const add = (selection: CapabilityParameterSelection) => {
    for (const id of selection.required) {
      required.add(id);
      if (!order.includes(id)) order.push(id);
    }
    for (const id of selection.optional) {
      if (!order.includes(id)) order.push(id);
    }
  };

  add(workflow.parameters);
  add(task.parameters);
  add(model.parameters);

  return order
    .filter((id) => id in capabilities.parameters)
    .map((id) => ({ id, required: required.has(id) }));
}

/**
 * Keeps only advertised parameters and validates each value against its
 * declared type. Empty optional values are dropped rather than forwarded, so
 * an untouched form field never reaches the command line.
 */
function resolveParameters(
  active: ActiveParameter[],
  catalog: Record<string, CapabilityParameter>,
  supplied: unknown,
): Record<string, string> {
  if (supplied !== undefined && !isRecord(supplied)) {
    throw new RunRequestError(
      "malformed_request",
      "Run request parameters must be an object",
      "parameters",
    );
  }

  const provided = (supplied ?? {}) as Record<string, unknown>;
  const activeIds = new Set(active.map((parameter) => parameter.id));

  for (const id of Object.keys(provided)) {
    if (!activeIds.has(id)) {
      throw new RunRequestError(
        "unknown_parameter",
        `Parameter is not advertised for this selection: ${id}`,
        id,
      );
    }
  }

  const values: Record<string, string> = {};
  for (const parameter of active) {
    const raw = provided[parameter.id];
    const value = raw === undefined || raw === null ? "" : String(raw).trim();

    if (value.length === 0) {
      if (parameter.required) {
        throw new RunRequestError(
          "missing_parameter",
          `Parameter is required for this selection: ${parameter.id}`,
          parameter.id,
        );
      }
      continue;
    }

    values[parameter.id] = validateParameterValue(
      parameter.id,
      catalog[parameter.id],
      value,
    );
  }

  return values;
}

function validateParameterValue(
  id: string,
  definition: CapabilityParameter,
  value: string,
): string {
  switch (definition.value_type) {
    case "boolean":
      if (value !== "true" && value !== "false") {
        throw invalidParameter(id, "must be true or false");
      }
      return value;
    case "enum":
      if (definition.values && !definition.values.includes(value)) {
        throw invalidParameter(
          id,
          `must be one of ${definition.values.join(", ")}`,
        );
      }
      return value;
    case "integer":
      if (!/^-?\d+$/.test(value)) {
        throw invalidParameter(id, "must be an integer");
      }
      return withinBounds(id, definition, Number(value));
    case "number":
      if (!Number.isFinite(Number(value))) {
        throw invalidParameter(id, "must be a number");
      }
      return withinBounds(id, definition, Number(value));
    default:
      return value;
  }
}

function withinBounds(
  id: string,
  definition: CapabilityParameter,
  value: number,
): string {
  if (definition.minimum !== undefined && value < definition.minimum) {
    throw invalidParameter(id, `must be >= ${definition.minimum}`);
  }
  if (definition.maximum !== undefined && value > definition.maximum) {
    throw invalidParameter(id, `must be <= ${definition.maximum}`);
  }
  return String(value);
}

function invalidParameter(id: string, requirement: string): RunRequestError {
  return new RunRequestError(
    "invalid_parameter",
    `Parameter ${id} ${requirement}`,
    id,
  );
}

function requireTask(
  capabilities: NeuriploCapabilities,
  value: unknown,
): CapabilityTask {
  const id = requireString(value, "task");
  const task = capabilities.tasks.find((candidate) => candidate.id === id);
  if (!task) {
    throw new RunRequestError("unknown_task", `Unknown task: ${id}`, "task");
  }
  return task;
}

function requireWorkflow(
  capabilities: NeuriploCapabilities,
  value: unknown,
): CapabilityWorkflow {
  const id = requireString(value, "execution.workflow");
  const workflow = capabilities.execution.workflows.find(
    (candidate) => candidate.id === id,
  );
  if (!workflow) {
    throw new RunRequestError(
      "unknown_workflow",
      `Execution workflow is not available in this build: ${id}`,
      "execution.workflow",
    );
  }
  return workflow;
}

/**
 * Local backends are compiled into the binary rather than selected on the
 * command line, so a backend is validated and echoed but never becomes an
 * argument. Requiring one for `local` is what keeps an incompatible build from
 * being launched.
 */
function resolveBackend(
  workflow: CapabilityWorkflow,
  value: unknown,
): string | null {
  if (workflow.backends.length === 0) {
    if (value !== undefined && value !== null && value !== "") {
      throw new RunRequestError(
        "unknown_backend",
        `Workflow ${workflow.id} advertises no local backends`,
        "execution.backend",
      );
    }
    return null;
  }

  const id = requireString(value, "execution.backend");
  if (!workflow.backends.includes(id)) {
    throw new RunRequestError(
      "unknown_backend",
      `Backend is not available in this build: ${id}`,
      "execution.backend",
    );
  }
  return id;
}

function resolveProtocol(
  workflow: CapabilityWorkflow,
  value: unknown,
): CapabilityProtocol | null {
  if (workflow.protocols.length === 0) {
    if (value !== undefined && value !== null && value !== "") {
      throw new RunRequestError(
        "unknown_protocol",
        `Workflow ${workflow.id} advertises no protocols`,
        "execution.protocol",
      );
    }
    return null;
  }

  const id = requireString(value, "execution.protocol");
  const protocol = workflow.protocols.find((candidate) => candidate.id === id);
  if (!protocol) {
    throw new RunRequestError(
      "unknown_protocol",
      `Protocol is not available in this build: ${id}`,
      "execution.protocol",
    );
  }
  return protocol;
}

function resolveTransport(
  protocol: CapabilityProtocol | null,
  value: unknown,
): string | null {
  if (!protocol) {
    if (value !== undefined && value !== null && value !== "") {
      throw new RunRequestError(
        "unknown_transport",
        "Transport requires a client-server protocol",
        "execution.transport",
      );
    }
    return null;
  }

  const id = requireString(value, "execution.transport");
  if (!protocol.transports.includes(id)) {
    throw new RunRequestError(
      "unknown_transport",
      `Transport is not available for ${protocol.id}: ${id}`,
      "execution.transport",
    );
  }
  return id;
}

function requireSourceType(task: CapabilityTask, value: unknown): string {
  const id = requireString(value, "source.type");
  if (!task.sources.types.includes(id)) {
    throw new RunRequestError(
      "unknown_source_type",
      `Source type is not advertised for ${task.id}: ${id}`,
      "source.type",
    );
  }
  return id;
}

function resolveSourcePaths(
  task: CapabilityTask,
  value: unknown,
  resolveSource: SourceResolver,
): string[] {
  if (value !== undefined && !Array.isArray(value)) {
    throw new RunRequestError(
      "invalid_source",
      "Source paths must be an array",
      "source.paths",
    );
  }

  const raw = ((value ?? []) as unknown[])
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter((entry) => entry.length > 0);

  const { min_items: min, max_items: max } = task.sources;
  if (raw.length < min) {
    throw new RunRequestError(
      "invalid_source",
      `Task ${task.id} requires at least ${min} source path(s)`,
      "source.paths",
    );
  }
  if (max >= 0 && raw.length > max) {
    throw new RunRequestError(
      "invalid_source",
      `Task ${task.id} accepts at most ${max} source path(s)`,
      "source.paths",
    );
  }

  // A comma separates sources on the command line, so a path containing one
  // would silently become two sources.
  for (const path of raw) {
    if (path.includes(",")) {
      throw new RunRequestError(
        "invalid_source",
        `Source paths must not contain a comma: ${path}`,
        "source.paths",
      );
    }
  }

  return raw.map(resolveSource);
}

/**
 * Resolves against the process working directory and, when
 * `NEURIPLO_UI_SOURCE_ROOT` is set, refuses anything outside that root.
 */
export function defaultSourceResolver(rawPath: string): string {
  const resolved = resolve(rawPath);
  const root = process.env.NEURIPLO_UI_SOURCE_ROOT?.trim();

  if (root) {
    const rootPath = resolve(root);
    const inside = relative(rootPath, resolved);
    if (inside.startsWith("..") || isAbsolute(inside)) {
      throw new RunRequestError(
        "invalid_source",
        `Source path is outside NEURIPLO_UI_SOURCE_ROOT: ${rawPath}`,
        "source.paths",
      );
    }
  }

  if (!existsSync(resolved)) {
    throw new RunRequestError(
      "invalid_source",
      `Source path does not exist: ${rawPath}`,
      "source.paths",
    );
  }

  return resolved;
}

/**
 * Mirrors the TaskFactory selector rule: case-insensitive, ignoring spaces,
 * dashes, and underscores. Exact ids and aliases win over wildcard families,
 * and the most specific family wins among wildcards.
 */
export function resolveModelSelector(
  task: CapabilityTask,
  selector: string,
): CapabilityModel | undefined {
  const normalized = normalizeSelector(selector);
  if (!normalized) return undefined;

  const exact = task.models.find((model) =>
    [model.id, ...model.aliases].some(
      (candidate) => normalizeSelector(candidate) === normalized,
    ),
  );
  if (exact) return exact;

  let best: { model: CapabilityModel; specificity: number } | undefined;
  for (const model of task.models) {
    for (const rawPattern of model.patterns) {
      const pattern = normalizeSelector(rawPattern);
      if (!matchesPattern(normalized, pattern)) continue;
      const specificity = pattern.replaceAll("*", "").length;
      if (!best || specificity > best.specificity) {
        best = { model, specificity };
      }
    }
  }

  return best?.model;
}

function normalizeSelector(value: string): string {
  return value.toLowerCase().replace(/[\s_-]/g, "");
}

function matchesPattern(value: string, pattern: string): boolean {
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new RunRequestError(
      "malformed_request",
      `Run request requires a non-empty ${field}`,
      field,
    );
  }
  return value.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
