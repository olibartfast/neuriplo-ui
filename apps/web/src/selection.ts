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

/**
 * Clamps a desired selection to what the capabilities actually offer, so
 * changing the task cannot leave an incompatible model or source selected.
 */
export function resolveSelection(
  capabilities: NeuriploCapabilities,
  desired: Partial<Selection> = {},
): ResolvedSelection {
  const task = pickById(capabilities.tasks, desired.taskId);
  const model = pickById(task.models, desired.modelId);
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

  const parameters = collectParameters(capabilities, workflow, task, model);
  const values = seedParameterValues(parameters, desired.parameters ?? {});

  return {
    selection: {
      taskId: task.id,
      modelId: model.id,
      workflowId: workflow.id,
      backend,
      protocolId: protocol?.id ?? null,
      transport,
      sourceType,
      parameters: values,
    },
    task,
    model,
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
