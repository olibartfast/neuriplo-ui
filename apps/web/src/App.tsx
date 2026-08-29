import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  CapabilitiesFetchError,
  fetchCapabilities,
  labelFor,
  type CapabilityParameter,
  type NeuriploCapabilities,
} from "./contract.js";
import {
  canAddSource,
  canRemoveSource,
  findTaskModelForSelector,
  missingRequirements,
  modelSelectorPatterns,
  modelSelectorSuggestions,
  resolveSelection,
  type ActiveParameter,
  type ResolvedSelection,
  type Selection,
} from "./selection.js";
import { RunFailedError, startRun } from "./run.js";
import { RemotePanel } from "./RemoteView.js";
import { remoteParameters } from "./remote.js";
import { RunPanel, type RunState } from "./RunView.js";
import { HistoryPanel } from "./HistoryView.js";
import { ComparePanel } from "./CompareView.js";
import { entryFor, remember, type HistoryEntry } from "./history.js";
import {
  DirectoryListingError,
  formatBytes,
  listDirectory,
  type DirectoryEntry,
  type DirectoryListing,
} from "./files.js";

/**
 * Ceiling on a repetition. Every run keeps its whole stdout and stderr in the
 * page and a directory on disk, so the count stays something a person chose.
 */
const MAX_REPEAT = 20;

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
  const [run, setRun] = useState<RunState>({ status: "idle" });
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  // Which retained run the panel is showing. Null means the live one, which is
  // what a fresh page, a running run, and a rejected request all are.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Which runs are being compared, which is a separate choice from which run
  // is displayed: comparing two should not stop you looking at a third.
  const [comparedIds, setComparedIds] = useState<string[]>([]);
  const [repeat, setRepeat] = useState(1);
  // Set for the whole batch, not just between requests: each finished run
  // leaves the live state "done" while later ones are still to come, so this
  // is what knows a batch is still in flight.
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(
    null,
  );

  const resolved = useMemo(
    () => resolveSelection(capabilities, desired),
    [capabilities, desired],
  );
  const { selection, task, workflow, protocol, parameters } = resolved;
  const [modelSelectorValid, setModelSelectorValid] = useState(true);

  // Keep the clamped selection as the next starting point, so switching task
  // carries over whatever remains compatible.
  const update = (patch: Partial<Selection>) =>
    setDesired({ ...selection, ...patch });

  const setParameter = (id: string, value: string) =>
    update({ parameters: { ...selection.parameters, [id]: value } });

  const setSource = (index: number, value: string) =>
    update({
      sources: selection.sources.map((source, position) =>
        position === index ? value : source,
      ),
    });

  const workflows = capabilities.execution.workflows;
  const remote = remoteParameters(capabilities, workflow);
  const missing = [
    ...(!modelSelectorValid ? ["model"] : []),
    ...missingRequirements(resolved),
  ];
  const required = parameters.filter((parameter) => parameter.required);
  const optional = parameters.filter((parameter) => !parameter.required);

  // A selected history entry replaces what the panel shows. The live state
  // wins whenever nothing is selected, so a launch always displays itself.
  // A batch holds the controls until every run in it has finished, because a
  // finished run leaves the live state "done" while later ones are pending.
  const busy = run.status === "running" || progress !== null;

  const selected = entryFor(history, selectedId);
  // A live error outranks a selection: a rejection that stopped a batch has to
  // be visible, not hidden behind the last run that did succeed.
  const shown: RunState =
    selected && run.status !== "running" && run.status !== "error"
      ? { status: "done", run: selected.run }
      : run;

  // Compared runs keep the order they were run in, oldest first, so the
  // columns read left to right the way the runs happened.
  const compared = history
    .filter((entry) => comparedIds.includes(entry.run.run_id))
    .map((entry) => entry.run)
    .reverse();

  const toggleCompare = (runId: string) =>
    setComparedIds((current) =>
      current.includes(runId)
        ? current.filter((id) => id !== runId)
        : [...current, runId],
    );

  /**
   * Runs the current configuration `repeat` times, one after another.
   *
   * Sequential rather than concurrent on purpose: parallel runs would contend
   * for the same device and make every measurement they produced meaningless.
   * A repetition stops at the first rejection, because the adapter refusing
   * the request means the remaining runs would be refused identically.
   */
  const launch = async () => {
    const total = Math.max(1, Math.min(repeat, MAX_REPEAT));
    setRun({ status: "running" });
    setSelectedId(null);
    setProgress({ done: 0, total });

    const launched: string[] = [];
    for (let index = 0; index < total; index += 1) {
      try {
        const result = await startRun(resolved);
        setRun({ status: "done", run: result });
        // A run that ran is retained and becomes the selection; a rejection
        // never gets here, because it has nothing to compare.
        setHistory((entries) => remember(entries, result));
        setSelectedId(result.run_id);
        launched.push(result.run_id);
        setProgress({ done: index + 1, total });
      } catch (error: unknown) {
        const failure =
          error instanceof RunFailedError
            ? error
            : new RunFailedError(
                "invalid_response",
                "The adapter returned an unreadable run result.",
              );
        setRun({
          status: "error",
          code: failure.code,
          message: failure.message,
        });
        // A batch that stopped early must say so. Leaving an earlier run
        // selected would keep showing a success the batch no longer had.
        setSelectedId(null);
        break;
      }
    }

    setProgress(null);
    // A repetition is a set worth looking at together, so it selects itself
    // for comparison rather than making the user tick each run.
    if (launched.length > 1) setComparedIds(launched);
  };

  return (
    <>
      <section className="panel" aria-label="Pipeline configuration">
        <div className="grid">
          <Choice
            label="Task"
            testId="task"
            value={selection.taskId}
            options={capabilities.tasks.map((entry) => entry.id)}
            onChange={(taskId) => {
              setModelSelectorValid(true);
              update({ taskId });
            }}
          />
          <ModelChoice
            key={task.id}
            value={selection.modelId}
            taskId={task.id}
            tasks={capabilities.tasks}
            models={task.models}
            onChange={(modelId) => update({ modelId })}
            onValidityChange={setModelSelectorValid}
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

        <SourcePaths
          resolved={resolved}
          onChange={setSource}
          onAdd={() => update({ sources: [...selection.sources, ""] })}
          onRemove={(index) =>
            update({
              sources: selection.sources.filter(
                (_, position) => position !== index,
              ),
            })
          }
        />

        {required.length > 0 && (
          <ParameterGroup
            title={`Required for ${labelFor(selection.workflowId)}`}
            parameters={required}
            values={selection.parameters}
            onChange={setParameter}
          />
        )}

        {/* Only the client-server workflow addresses a server, and only a
            contract that advertises a url parameter says where. */}
        {remote.endpoint !== null && (
          <RemotePanel
            endpoint={selection.parameters[remote.endpoint] ?? ""}
            model={
              remote.model ? (selection.parameters[remote.model] ?? null) : null
            }
            version={
              remote.version
                ? (selection.parameters[remote.version] ?? null)
                : null
            }
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

        <div className="launch">
          <button
            data-testid="run"
            type="button"
            disabled={missing.length > 0 || busy}
            onClick={() => void launch()}
          >
            {busy
              ? progress && progress.total > 1
                ? `Running ${Math.min(progress.done + 1, progress.total)} of ${progress.total}…`
                : "Running…"
              : repeat > 1
                ? `Run ${repeat} times`
                : "Run inference"}
          </button>
          <label className="repeat">
            <span>Repeat</span>
            <input
              data-testid="repeat"
              type="number"
              min={1}
              max={MAX_REPEAT}
              value={repeat}
              disabled={busy}
              onChange={(event) =>
                setRepeat(
                  Math.max(
                    1,
                    Math.min(MAX_REPEAT, Number(event.target.value) || 1),
                  ),
                )
              }
            />
          </label>
        </div>
        <p className="hint" data-testid="run-hint">
          {missing.length > 0
            ? `Provide ${missing.map(labelFor).join(", ")} before running.`
            : repeat > 1
              ? `Launches ${repeat} runs one after another, so they do not contend for the same device.`
              : "Launches neuriplo-infer through the local adapter."}
        </p>
      </section>

      <RunPanel state={shown} capabilities={capabilities} />

      <HistoryPanel
        history={history}
        selectedId={selectedId}
        comparedIds={comparedIds}
        onSelect={setSelectedId}
        onToggleCompare={toggleCompare}
      />

      <ComparePanel runs={compared} />
    </>
  );
}

function SourcePaths({
  resolved,
  onChange,
  onAdd,
  onRemove,
}: {
  resolved: ResolvedSelection;
  onChange: (index: number, value: string) => void;
  onAdd: () => void;
  onRemove: (index: number) => void;
}) {
  const { task, selection } = resolved;
  const removable = canRemoveSource(task, selection.sources);

  return (
    <div className="parameters">
      <div className="grid">
        {selection.sources.map((source, index) => (
          <label key={index}>
            <span>
              {labelFor(selection.sourceType)}
              {selection.sources.length > 1 ? ` ${index + 1}` : ""}
              {index < task.sources.min_items && (
                <em className="required"> required</em>
              )}
            </span>
            <PathField
              testId={`source-path-${index}`}
              title={`Select ${labelFor(selection.sourceType).toLowerCase()}`}
              value={source}
              onChange={(next) => onChange(index, next)}
            />
            {removable && (
              <button
                data-testid={`remove-source-${index}`}
                type="button"
                className="inline"
                onClick={() => onRemove(index)}
              >
                Remove
              </button>
            )}
          </label>
        ))}
      </div>
      {canAddSource(task, selection.sources) && (
        <button
          data-testid="add-source"
          type="button"
          className="inline"
          onClick={onAdd}
        >
          Add source
        </button>
      )}
      <p className="hint">
        Paths are read by the adapter, so they are resolved on the machine
        running neuriplo-infer.
      </p>
    </div>
  );
}

function ModelChoice({
  value,
  taskId,
  tasks,
  models,
  onChange,
  onValidityChange,
}: {
  value: string;
  taskId: string;
  tasks: NeuriploCapabilities["tasks"];
  models: NeuriploCapabilities["tasks"][number]["models"];
  onChange: (value: string) => void;
  onValidityChange: (valid: boolean) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);
  const suggestions = modelSelectorSuggestions(models);
  const patterns = modelSelectorPatterns(models);
  const listId = useId();

  const commit = () => {
    const selector = draft.trim();
    const valid = findTaskModelForSelector(tasks, selector)?.task.id === taskId;
    setInvalid(!valid);
    onValidityChange(valid);
    if (valid) {
      setDraft(selector);
      onChange(selector);
    }
  };

  const reset = () => {
    setDraft(value);
    setInvalid(false);
    onValidityChange(true);
  };

  return (
    <label>
      <span>Model</span>
      <input
        data-testid="model"
        type="text"
        list={listId}
        value={draft}
        aria-invalid={invalid}
        aria-describedby={patterns.length > 0 ? `${listId}-patterns` : undefined}
        onChange={(event) => {
          setDraft(event.target.value);
          setInvalid(false);
          onValidityChange(false);
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit();
          } else if (event.key === "Escape") {
            reset();
          }
        }}
      />
      <datalist id={listId} data-testid="model-suggestions">
        {suggestions.map((selector) => (
          <option key={selector} value={selector} />
        ))}
      </datalist>
      {patterns.length > 0 && (
        <small id={`${listId}-patterns`} className="flag">
          Accepted families: {patterns.join(", ")}
        </small>
      )}
      {invalid && (
        <small className="field-error" role="alert">
          This selector is not advertised for the selected task.
        </small>
      )}
    </label>
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
    case "path":
      // Every parameter the contract types as a path becomes browsable, so a
      // newly advertised path parameter gets a picker without a change here.
      return (
        <PathField
          testId={testId}
          title="Select file"
          value={value}
          onChange={onChange}
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

/** A path input paired with a picker that browses the adapter's filesystem. */
function PathField({
  testId,
  title,
  value,
  onChange,
}: {
  testId: string;
  title: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const [browsing, setBrowsing] = useState(false);

  return (
    <>
      <div className="path-field">
        <input
          data-testid={testId}
          type="text"
          value={value}
          placeholder="/path/to/file"
          onChange={(event) => onChange(event.target.value)}
        />
        <button
          data-testid={`browse-${testId}`}
          type="button"
          className="inline"
          onClick={() => setBrowsing(true)}
        >
          Browse…
        </button>
      </div>
      {browsing &&
        createPortal(
          <FileBrowser
            title={title}
            startAt={value}
            onCancel={() => setBrowsing(false)}
            onSelect={(path) => {
              onChange(path);
              setBrowsing(false);
            }}
          />,
          document.body,
        )}
    </>
  );
}

type BrowseState =
  | { status: "loading" }
  | { status: "ready"; listing: DirectoryListing }
  | { status: "error"; message: string };

function FileBrowser({
  title,
  startAt,
  onSelect,
  onCancel,
}: {
  title: string;
  /** A previously chosen path, so reopening resumes where it left off. */
  startAt: string;
  onSelect: (path: string) => void;
  onCancel: () => void;
}) {
  // Undefined asks the adapter for its own starting directory rather than
  // guessing one in the browser.
  const [directory, setDirectory] = useState<string | undefined>(
    startAt.trim() ? parentPath(startAt.trim()) : undefined,
  );
  const [state, setState] = useState<BrowseState>({ status: "loading" });
  const [selected, setSelected] = useState<string | null>(
    startAt.trim() || null,
  );

  useEffect(() => {
    const controller = new AbortController();
    setState({ status: "loading" });

    listDirectory(directory, controller.signal)
      .then((listing) => setState({ status: "ready", listing }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          status: "error",
          message:
            error instanceof DirectoryListingError
              ? error.message
              : "That directory could not be listed.",
        });
      });

    return () => controller.abort();
  }, [directory]);

  const choose = (entry: DirectoryEntry) => {
    if (entry.kind === "directory") {
      setDirectory(entry.path);
      setSelected(null);
      return;
    }
    setSelected(entry.path);
  };

  return (
    <div
      className="browser-backdrop"
      role="presentation"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div
        className="browser"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        data-testid="file-browser"
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel();
        }}
      >
        <h2>{title}</h2>
        <p className="browser-path" data-testid="file-browser-path">
          {state.status === "ready" ? state.listing.path : directory ?? "…"}
        </p>

        <div className="browser-list">
          {state.status === "loading" && <p className="hint">Listing…</p>}
          {state.status === "error" && (
            <p className="field-error" role="alert">
              {state.message}
            </p>
          )}
          {state.status === "ready" && (
            <>
              {state.listing.parent !== null && (
                <button
                  data-testid="file-browser-up"
                  type="button"
                  className="browser-entry"
                  onClick={() => {
                    setDirectory(state.listing.parent ?? undefined);
                    setSelected(null);
                  }}
                >
                  <span>📁 ..</span>
                </button>
              )}
              {state.listing.entries.map((entry) => (
                <button
                  key={entry.path}
                  data-testid={`file-entry-${entry.name}`}
                  type="button"
                  className="browser-entry"
                  aria-pressed={selected === entry.path}
                  onClick={() => choose(entry)}
                  onDoubleClick={() => {
                    if (entry.kind === "file") onSelect(entry.path);
                  }}
                >
                  <span>
                    {entry.kind === "directory" ? "📁" : "📄"} {entry.name}
                  </span>
                  <small className="flag">{formatBytes(entry.bytes)}</small>
                </button>
              ))}
              {state.listing.entries.length === 0 && (
                <p className="hint">This directory is empty.</p>
              )}
              {state.listing.truncated && (
                <p className="hint">
                  Only the first {state.listing.entries.length} entries are
                  listed.
                </p>
              )}
            </>
          )}
        </div>

        <div className="browser-actions">
          <span className="flag" data-testid="file-browser-selection">
            {selected ?? "Nothing selected"}
          </span>
          <span className="browser-buttons">
            <button
              data-testid="file-browser-cancel"
              type="button"
              className="inline"
              onClick={onCancel}
            >
              Cancel
            </button>
            <button
              data-testid="file-browser-select"
              type="button"
              className="inline"
              disabled={selected === null}
              onClick={() => selected && onSelect(selected)}
            >
              Select
            </button>
          </span>
        </div>
      </div>
    </div>
  );
}

/** Directory holding a path, so reopening the picker resumes beside it. */
function parentPath(path: string): string | undefined {
  const index = path.replace(/\/+$/, "").lastIndexOf("/");
  if (index < 0) return undefined;
  return index === 0 ? "/" : path.slice(0, index);
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
