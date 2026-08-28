import { useState } from "react";
import type { NeuriploCapabilities } from "./contract.js";
import type { RunArtifact, RunResult } from "./run.js";
import { formatBytes } from "./files.js";
import {
  copyText,
  describeExecution,
  formatCommand,
  formatDuration,
  formatJson,
  summarizeOutcome,
  type CopyState,
} from "./results.js";

/**
 * The terminal view of a run. Everything shown here comes from the run
 * response: the command is the one the adapter spawned, the duration is
 * adapter-observed wall time, and a structured result is rendered generically
 * because the producer does not yet publish a versioned result schema.
 */

export type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; run: RunResult }
  | { status: "error"; code: string; message: string };

export function RunPanel({
  state,
  capabilities,
}: {
  state: RunState;
  capabilities: NeuriploCapabilities;
}) {
  const producer = (
    <p className="hint" data-testid="producer">
      neuriplo-infer {capabilities.producer.version} · schema v
      {capabilities.schema_version}
    </p>
  );

  if (state.status === "idle") {
    return (
      <section className="panel empty-state" aria-label="Run result">
        <span data-testid="run-status">Idle</span>
        <p>Results, logs, and generated artifacts will appear here.</p>
        {producer}
      </section>
    );
  }

  if (state.status === "running") {
    return (
      <section className="panel empty-state" aria-label="Run result">
        <span data-testid="run-status">Running</span>
        <p>Waiting for neuriplo-infer to finish.</p>
        {producer}
      </section>
    );
  }

  // A rejected request never reached the binary, so it has no command, exit
  // code, or duration and must not be dressed up as a run that happened.
  if (state.status === "error") {
    return (
      <section className="panel notice" aria-label="Run result">
        <span data-testid="run-status">Rejected</span>
        <p data-testid="run-error">{state.message}</p>
        <p className="hint" data-testid="run-summary">
          The adapter refused the request with: {state.code}. neuriplo-infer was
          not started.
        </p>
        {producer}
      </section>
    );
  }

  const { run } = state;
  const failed = run.status !== "success";

  return (
    <section
      className={failed ? "panel notice" : "panel"}
      aria-label="Run result"
    >
      <span data-testid="run-status">{failed ? "Failed" : "Succeeded"}</span>
      {run.error && <p data-testid="run-error">{run.error.message}</p>}

      <dl className="run-header" data-testid="run-header">
        <Fact label="Task" value={run.task} />
        <Fact label="Model" value={run.model} />
        <Fact label="Execution" value={describeExecution(run.execution)} />
        <Fact
          label="Wall time (whole process)"
          value={formatDuration(run.duration_ms)}
          testId="run-duration"
        />
        <Fact
          label="Exit"
          value={run.exit_code === null ? "—" : String(run.exit_code)}
        />
        {run.signal && <Fact label="Signal" value={run.signal} />}
        {run.timed_out && <Fact label="Timed out" value="yes" />}
        <Fact label="Run id" value={run.run_id} testId="run-id" />
      </dl>

      <p className="hint" data-testid="run-summary">
        {summarizeOutcome(run).join(" · ")}
      </p>

      <CommandBlock command={run.command} />
      {run.result !== null && run.result !== undefined && (
        <StructuredResult result={run.result} />
      )}
      {run.artifacts.length > 0 && <Artifacts artifacts={run.artifacts} />}
      <Logs stdout={run.stdout} stderr={run.stderr} failed={failed} />
      {producer}
    </section>
  );
}

function Fact({
  label,
  value,
  testId,
}: {
  label: string;
  value: string;
  testId?: string;
}) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd data-testid={testId}>{value}</dd>
    </div>
  );
}

function CommandBlock({ command }: { command: RunResult["command"] }) {
  const [copy, setCopy] = useState<CopyState>({ status: "idle" });
  const text = formatCommand(command);

  const onCopy = () => {
    void copyText(
      text,
      typeof navigator === "undefined" ? undefined : navigator.clipboard,
    ).then((next) => {
      setCopy(next);
      if (next.status === "copied") {
        setTimeout(() => setCopy({ status: "idle" }), 2000);
      }
    });
  };

  return (
    <section className="result-section" aria-label="Command">
      <h2>Command</h2>
      <pre className="command" data-testid="run-command">
        <code>{text}</code>
      </pre>
      <div className="command-actions">
        <button
          data-testid="copy-command"
          type="button"
          className="inline"
          onClick={onCopy}
        >
          Copy command
        </button>
        <span
          className={copy.status === "failed" ? "field-error" : "flag"}
          data-testid="copy-status"
          role="status"
        >
          {copy.status === "copied"
            ? "Copied"
            : copy.status === "failed"
              ? copy.message
              : ""}
        </span>
      </div>
      <p className="hint">
        Quoted for a POSIX shell from the arguments the adapter spawned.
      </p>
    </section>
  );
}

/**
 * Rendered generically for objects, arrays, and scalars alike. Task-specific
 * tables wait for a versioned producer result schema.
 */
function StructuredResult({ result }: { result: unknown }) {
  return (
    <section className="result-section" aria-label="Structured result">
      <h2>Structured result</h2>
      <pre className="json" data-testid="structured-result">
        <code>{formatJson(result)}</code>
      </pre>
    </section>
  );
}

function Logs({
  stdout,
  stderr,
  failed,
}: {
  stdout: string;
  stderr: string;
  failed: boolean;
}) {
  return (
    <section className="result-section" aria-label="Logs">
      <h2>Logs</h2>
      {/* A failure puts its diagnosis on stderr, so that stream opens itself
          without hiding stdout. */}
      <LogStream name="stderr" text={stderr} open={failed} />
      <LogStream name="stdout" text={stdout} open={false} />
    </section>
  );
}

function LogStream({
  name,
  text,
  open,
}: {
  name: string;
  text: string;
  open: boolean;
}) {
  const empty = text.trim().length === 0;
  return (
    <details className="log" open={open}>
      <summary data-testid={`log-toggle-${name}`}>
        {name}
        {empty ? " (empty)" : ""}
      </summary>
      <pre className="log-body" data-testid={`log-${name}`}>
        <code>{empty ? "No output" : text}</code>
      </pre>
    </details>
  );
}

export function Artifacts({ artifacts }: { artifacts: RunArtifact[] }) {
  return (
    <section className="result-section" aria-label="Artifacts">
      <h2>Artifacts</h2>
      <ul className="artifacts" data-testid="artifacts">
        {artifacts.map((artifact) => (
          <li key={artifact.name}>
            <div className="artifact-meta">
              <a href={artifact.url} target="_blank" rel="noreferrer">
                {artifact.name}
              </a>
              <small className="flag">
                {artifact.media_type} · {formatBytes(artifact.bytes)}
              </small>
            </div>
            {/* The adapter reports the media type, so anything the browser can
                display is shown rather than only offered as a download. */}
            {artifact.media_type.startsWith("image/") && (
              <a href={artifact.url} target="_blank" rel="noreferrer">
                <img
                  data-testid={`artifact-preview-${artifact.name}`}
                  className="artifact-preview"
                  src={artifact.url}
                  alt={`Output rendered by neuriplo-infer: ${artifact.name}`}
                  loading="lazy"
                />
              </a>
            )}
            {artifact.media_type.startsWith("video/") && (
              <video
                data-testid={`artifact-preview-${artifact.name}`}
                className="artifact-preview"
                src={artifact.url}
                controls
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
