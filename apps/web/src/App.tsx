import { useEffect, useMemo, useState } from "react";
import {
  CapabilitiesFetchError,
  fetchCapabilities,
  labelFor,
  type CapabilityParameter,
  type NeuriploCapabilities,
} from "./contract.js";
import {
  missingRequirements,
  resolveSelection,
  type ActiveParameter,
  type Selection,
} from "./selection.js";

type DiscoveryState =
  | { status: "loading" }
  | { status: "ready"; capabilities: NeuriploCapabilities }
  | { status: "error"; code: string; message: string };

export function App() {
  const [discovery, setDiscovery] = useState<DiscoveryState>({
    status: "loading",
  });

  useEffect(() => {
    const controller = new AbortController();

    fetchCapabilities(controller.signal)
      .then((capabilities) => setDiscovery({ status: "ready", capabilities }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        const failure =
          error instanceof CapabilitiesFetchError
            ? error
            : new CapabilitiesFetchError(
                "invalid_response",
                "The adapter returned an unreadable capabilities payload.",
              );
        setDiscovery({
          status: "error",
          code: failure.code,
          message: failure.message,
        });
      });

    return () => controller.abort();
  }, []);

  return (
    <main className="page-shell">
      <header>
        <p className="eyebrow">Neuriplo</p>
        <h1>Inference Pipeline</h1>
        <p className="subtitle">
          Configure and exercise the Neuriplo inference stack end to end.
        </p>
      </header>

      {discovery.status === "loading" && <DiscoveryPending />}
      {discovery.status === "error" && <DiscoveryFailed {...discovery} />}
      {discovery.status === "ready" && (
        <Configurator capabilities={discovery.capabilities} />
      )}
    </main>
  );
}

function DiscoveryPending() {
  return (
    <section className="panel empty-state" aria-label="Capability discovery">
      <span data-testid="capabilities-status">Discovering capabilities…</span>
      <p>Asking neuriplo-infer which tasks, models, and backends it supports.</p>
    </section>
  );
}

function DiscoveryFailed({ code, message }: { code: string; message: string }) {
  return (
    <section className="panel notice" aria-label="Capability discovery">
      <span data-testid="capabilities-status">Capabilities unavailable</span>
      <p data-testid="capabilities-error">{message}</p>
      <p className="hint">
        {code === "not_configured"
          ? "Set NEURIPLO_INFER_BIN to a neuriplo-infer build and restart the adapter."
          : `Discovery failed with: ${code}`}
      </p>
    </section>
  );
}

function Configurator({
  capabilities,
}: {
  capabilities: NeuriploCapabilities;
}) {
  const [desired, setDesired] = useState<Partial<Selection>>({});

  const resolved = useMemo(
    () => resolveSelection(capabilities, desired),
    [capabilities, desired],
  );
  const { selection, task, workflow, protocol, parameters } = resolved;

  // Keep the clamped selection as the next starting point, so switching task
  // carries over whatever remains compatible.
  const update = (patch: Partial<Selection>) =>
    setDesired({ ...selection, ...patch });

  const setParameter = (id: string, value: string) =>
    update({ parameters: { ...selection.parameters, [id]: value } });

  const workflows = capabilities.execution.workflows;
  const missing = missingRequirements(resolved);
  const required = parameters.filter((parameter) => parameter.required);
  const optional = parameters.filter((parameter) => !parameter.required);

  return (
    <>
      <section className="panel" aria-label="Pipeline configuration">
        <div className="grid">
          <Choice
            label="Task"
            testId="task"
            value={selection.taskId}
            options={capabilities.tasks.map((entry) => entry.id)}
            onChange={(taskId) => update({ taskId })}
          />
          <Choice
            label="Model"
            testId="model"
            value={selection.modelId}
            options={task.models.map((entry) => entry.id)}
            onChange={(modelId) => update({ modelId })}
            verbatim
          />
          {workflows.length > 1 && (
            <Choice
              label="Execution"
              testId="workflow"
              value={selection.workflowId}
              options={workflows.map((entry) => entry.id)}
              onChange={(workflowId) => update({ workflowId })}
            />
          )}
          {selection.backend !== null && (
            <Choice
              label="Inference backend"
              testId="backend"
              value={selection.backend}
              options={workflow.backends}
              onChange={(backend) => update({ backend })}
              verbatim
            />
          )}
          {protocol && (
            <Choice
              label="Protocol"
              testId="protocol"
              value={protocol.id}
              options={workflow.protocols.map((entry) => entry.id)}
              onChange={(protocolId) => update({ protocolId })}
              verbatim
            />
          )}
          {protocol && selection.transport !== null && (
            <Choice
              label="Transport"
              testId="transport"
              value={selection.transport}
              options={protocol.transports}
              onChange={(transport) => update({ transport })}
              verbatim
            />
          )}
          <Choice
            label="Source"
            testId="source"
            value={selection.sourceType}
            options={task.sources.types}
            onChange={(sourceType) => update({ sourceType })}
          />
        </div>

        {required.length > 0 && (
          <ParameterGroup
            title={`Required for ${labelFor(selection.workflowId)}`}
            parameters={required}
            values={selection.parameters}
            onChange={setParameter}
          />
        )}

        {optional.length > 0 && (
          <details className="advanced">
            <summary data-testid="advanced-toggle">
              Advanced parameters ({optional.length})
            </summary>
            <ParameterGroup
              parameters={optional}
              values={selection.parameters}
              onChange={setParameter}
            />
          </details>
        )}

        <button data-testid="run" type="button" disabled>
          Run inference
        </button>
        <p className="hint" data-testid="run-hint">
          {missing.length > 0
            ? `Provide ${missing.map(labelFor).join(", ")} before running.`
            : "Runner integration is the next milestone."}
        </p>
      </section>

      <section className="panel empty-state" aria-label="Run result">
        <span data-testid="run-status">Idle</span>
        <p>Results, latency, logs, and generated artifacts will appear here.</p>
        <p className="hint" data-testid="producer">
          neuriplo-infer {capabilities.producer.version} · schema v
          {capabilities.schema_version}
        </p>
      </section>
    </>
  );
}

function Choice({
  label,
  testId,
  value,
  options,
  onChange,
  verbatim = false,
}: {
  label: string;
  testId: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
  /** Render contract ids as-is, for values that map onto CLI arguments. */
  verbatim?: boolean;
}) {
  return (
    <label>
      <span>{label}</span>
      <select
        data-testid={testId}
        value={value}
        disabled={options.length < 2}
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {verbatim ? option : labelFor(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function ParameterGroup({
  title,
  parameters,
  values,
  onChange,
}: {
  title?: string;
  parameters: ActiveParameter[];
  values: Record<string, string>;
  onChange: (id: string, value: string) => void;
}) {
  return (
    <div className="parameters">
      {title && <h2>{title}</h2>}
      <div className="grid">
        {parameters.map((parameter) => (
          <ParameterControl
            key={parameter.id}
            parameter={parameter}
            value={values[parameter.id] ?? ""}
            onChange={(value) => onChange(parameter.id, value)}
          />
        ))}
      </div>
    </div>
  );
}

function ParameterControl({
  parameter,
  value,
  onChange,
}: {
  parameter: ActiveParameter;
  value: string;
  onChange: (value: string) => void;
}) {
  const { definition } = parameter;
  const testId = `param-${parameter.id}`;

  return (
    <label>
      <span>
        {labelFor(parameter.id)}
        {parameter.required && <em className="required"> required</em>}
      </span>
      {renderControl(definition, value, onChange, testId)}
      <small className="flag">--{definition.cli_flag}</small>
    </label>
  );
}

function renderControl(
  definition: CapabilityParameter,
  value: string,
  onChange: (value: string) => void,
  testId: string,
) {
  switch (definition.value_type) {
    case "boolean":
      return (
        <input
          data-testid={testId}
          type="checkbox"
          checked={value === "true"}
          onChange={(event) => onChange(String(event.target.checked))}
        />
      );
    case "enum":
      return (
        <select
          data-testid={testId}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          {(definition.values ?? []).map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      );
    case "integer":
    case "number":
      return (
        <input
          data-testid={testId}
          type="number"
          value={value}
          min={definition.minimum}
          max={definition.maximum}
          step={definition.value_type === "integer" ? 1 : "any"}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    default:
      return (
        <input
          data-testid={testId}
          type="text"
          value={value}
          placeholder={placeholderFor(definition)}
          onChange={(event) => onChange(event.target.value)}
        />
      );
  }
}

function placeholderFor(definition: CapabilityParameter): string {
  switch (definition.value_type) {
    case "url":
      return "https://host:port";
    case "path":
      return "/path/to/file";
    case "shape_list":
    case "string_list":
      return `separated by "${definition.separator ?? ","}"`;
    default:
      return "";
  }
}
