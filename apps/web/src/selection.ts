import type {
  CapabilityModel,
  CapabilityParameter,
  CapabilityParameterSelection,
  CapabilityProtocol,
  CapabilityTask,
  CapabilityWorkflow,
  NeuriploCapabilities,
} from "./contract.js";

export type Selection = {
  taskId: string;
  modelId: string;
  workflowId: string;
  /** Local backend, or null when the workflow advertises none. */
  backend: string | null;
  protocolId: string | null;
  transport: string | null;
  sourceType: string;
  parameters: Record<string, string>;
};

export type ResolvedSelection = {
  selection: Selection;
  task: CapabilityTask;
  model: CapabilityModel;
  workflow: CapabilityWorkflow;
  protocol: CapabilityProtocol | null;
  /** Parameters contributed by the workflow, task, and model, in that order. */
  parameters: ActiveParameter[];
};

export type ActiveParameter = {
  id: string;
  required: boolean;
  definition: CapabilityParameter;
};

/** Concrete selectors that can be suggested without inventing wildcard text. */
export function modelSelectorSuggestions(models: CapabilityModel[]): string[] {
  return unique(models.flatMap((model) => [model.id, ...model.aliases]));
}

/** Wildcard families accepted by the task but not suitable as CLI values. */
export function modelSelectorPatterns(models: CapabilityModel[]): string[] {
  return unique(models.flatMap((model) => model.patterns));
}

/** Resolves a concrete model selector to its capability declaration. */
export function findModelForSelector(
  models: CapabilityModel[],
  selector: string,
): CapabilityModel | undefined {
  const normalized = normalizeModelSelector(selector);
  if (!normalized) return undefined;

  const exact = models.find((model) =>
    [model.id, ...model.aliases].some(
      (candidate) => normalizeModelSelector(candidate) === normalized,
    ),
  );
  if (exact) return exact;

  return bestPatternMatch(models, normalized)?.model;
}

/**
 * Finds the task/model owning a selector. Exact selectors win; wildcard
 * overlaps use the most specific pattern, mirroring the factory's load-bearing
 * "specific task before generic family" ordering.
 */
export function findTaskModelForSelector(
  tasks: CapabilityTask[],
  selector: string,
): { task: CapabilityTask; model: CapabilityModel } | undefined {
  const normalized = normalizeModelSelector(selector);
  if (!normalized) return undefined;

  for (const task of tasks) {
    const model = task.models.find((candidate) =>
      [candidate.id, ...candidate.aliases].some(
        (value) => normalizeModelSelector(value) === normalized,
      ),
    );
    if (model) return { task, model };
  }

  let best:
    | { task: CapabilityTask; model: CapabilityModel; specificity: number }
    | undefined;
  for (const task of tasks) {
    const match = bestPatternMatch(task.models, normalized);
    if (match && (!best || match.specificity > best.specificity)) {
      best = { task, ...match };
    }
  }

  return best && { task: best.task, model: best.model };
}

/**
 * Clamps a desired selection to what the capabilities actually offer, so
 * changing the task cannot leave an incompatible model or source selected.
 */
export function resolveSelection(
  capabilities: NeuriploCapabilities,
  desired: Partial<Selection> = {},
): ResolvedSelection {
  const task = pickById(capabilities.tasks, desired.taskId);
  const requestedModel = desired.modelId?.trim();
  const matched = requestedModel
    ? findTaskModelForSelector(capabilities.tasks, requestedModel)
    : undefined;
  const model = matched?.task.id === task.id ? matched.model : undefined;
  const selectedModel = model ?? task.models[0];
  const modelId = model && requestedModel ? requestedModel : selectedModel.id;
  const workflow = pickById(capabilities.execution.workflows, desired.workflowId);

  const backend = pickValue(workflow.backends, desired.backend);
  const protocol =
    workflow.protocols.length > 0
      ? pickById(workflow.protocols, desired.protocolId)
      : null;
  const transport = protocol
    ? pickValue(protocol.transports, desired.transport)
    : null;
  const sourceType =
    pickValue(task.sources.types, desired.sourceType) ??
    task.sources.types[0] ??
    "";

  const parameters = collectParameters(
    capabilities,
    workflow,
    task,
    selectedModel,
  );
  const values = seedParameterValues(parameters, desired.parameters ?? {});

  return {
    selection: {
      taskId: task.id,
      modelId,
      workflowId: workflow.id,
      backend,
      protocolId: protocol?.id ?? null,
      transport,
      sourceType,
      parameters: values,
    },
    task,
    model: selectedModel,
    workflow,
    protocol,
    parameters,
  };
}

/**
 * Union of the parameters the selected workflow, task, and model declare.
 * A parameter required by any contributor is required overall.
 */
function collectParameters(
  capabilities: NeuriploCapabilities,
  workflow: CapabilityWorkflow,
  task: CapabilityTask,
  model: CapabilityModel,
): ActiveParameter[] {
  const required = new Set<string>();
  const seen: string[] = [];

  const add = (selection: CapabilityParameterSelection) => {
    for (const id of selection.required) {
      required.add(id);
      if (!seen.includes(id)) seen.push(id);
    }
    for (const id of selection.optional) {
      if (!seen.includes(id)) seen.push(id);
    }
  };

  add(workflow.parameters);
  add(task.parameters);
  add(model.parameters);

  return seen
    .filter((id) => id in capabilities.parameters)
    .map((id) => ({
      id,
      required: required.has(id),
      definition: capabilities.parameters[id],
    }));
}

/** Keeps values for parameters that are still active, defaulting the rest. */
function seedParameterValues(
  parameters: ActiveParameter[],
  previous: Record<string, string>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const parameter of parameters) {
    values[parameter.id] =
      previous[parameter.id] ?? defaultValueFor(parameter.definition);
  }
  return values;
}

function defaultValueFor(definition: CapabilityParameter): string {
  if (definition.default !== undefined && definition.default !== null) {
    return String(definition.default);
  }
  if (definition.value_type === "boolean") return "false";
  if (definition.value_type === "enum") return definition.values?.[0] ?? "";
  return "";
}

/** Ids of required parameters that have no usable value yet. */
export function missingRequirements(resolved: ResolvedSelection): string[] {
  return resolved.parameters
    .filter((parameter) => parameter.required)
    .filter(
      (parameter) =>
        resolved.selection.parameters[parameter.id]?.trim().length === 0,
    )
    .map((parameter) => parameter.id);
}

function pickById<T extends { id: string }>(
  items: T[],
  desired?: string | null,
): T {
  return items.find((item) => item.id === desired) ?? items[0];
}

function pickValue(values: string[], desired?: string | null): string | null {
  if (values.length === 0) return null;
  return values.find((value) => value === desired) ?? values[0];
}

/** Mirrors TaskFactory normalization: case-insensitive, ignoring space/-/_. */
function normalizeModelSelector(value: string): string {
  return value.toLowerCase().replace(/[\s_-]/g, "");
}

function matchesModelPattern(value: string, pattern: string): boolean {
  const expression = pattern
    .split("*")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${expression}$`).test(value);
}

function bestPatternMatch(
  models: CapabilityModel[],
  normalizedSelector: string,
): { model: CapabilityModel; specificity: number } | undefined {
  let best: { model: CapabilityModel; specificity: number } | undefined;
  for (const model of models) {
    for (const rawPattern of model.patterns) {
      const pattern = normalizeModelSelector(rawPattern);
      if (!matchesModelPattern(normalizedSelector, pattern)) continue;
      const specificity = pattern.replaceAll("*", "").length;
      if (!best || specificity > best.specificity) {
        best = { model, specificity };
      }
    }
  }
  return best;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}
