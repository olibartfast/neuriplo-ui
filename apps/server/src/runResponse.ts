import type { PlannedRun } from "./runs.js";
import type { RunOutcome } from "./runner.js";

/**
 * Shapes a finished process into the run resource the UI consumes.
 *
 * A run that started and failed is still a successful API call: the HTTP layer
 * only reports 4xx/5xx when the adapter could not run anything at all. That
 * keeps "the pipeline failed" (which has an exit code, logs, and a duration)
 * distinguishable from "the adapter is misconfigured".
 */

export type RunResponseArtifact = {
  name: string;
  media_type: string;
  bytes: number;
  url: string;
};

export type RunResponse = {
  status: "success" | "failed";
  run_id: string;
  task: string;
  model: string;
  execution: {
    workflow: string;
    backend: string | null;
    protocol: string | null;
    transport: string | null;
  };
  source: { type: string; paths: string[] };
  command: { bin: string; args: string[] };
  exit_code: number | null;
  signal: string | null;
  timed_out: boolean;
  duration_ms: number;
  artifacts: RunResponseArtifact[];
  /** Parsed stdout when the run emitted JSON, otherwise null. */
  result: unknown;
  stdout: string;
  stderr: string;
  error: { code: string; message: string } | null;
};

export function buildRunResponse(
  plan: PlannedRun,
  outcome: RunOutcome,
): RunResponse {
  const succeeded = !outcome.timedOut && outcome.exitCode === 0;

  return {
    status: succeeded ? "success" : "failed",
    run_id: outcome.runId,
    task: plan.task.id,
    model: plan.modelSelector,
    execution: {
      workflow: plan.workflow.id,
      backend: plan.backend,
      protocol: plan.protocol?.id ?? null,
      transport: plan.transport,
    },
    source: { type: plan.sourceType, paths: plan.sourcePaths },
    command: { bin: outcome.binaryPath, args: outcome.args },
    exit_code: outcome.exitCode,
    signal: outcome.signal,
    timed_out: outcome.timedOut,
    duration_ms: outcome.durationMs,
    artifacts: outcome.artifacts.map((artifact) => ({
      ...artifact,
      url: artifactUrl(outcome.runId, artifact.name),
    })),
    result: parseStructuredResult(outcome.stdout),
    stdout: outcome.stdout,
    stderr: outcome.stderr,
    error: succeeded ? null : failureFor(outcome),
  };
}

function artifactUrl(runId: string, name: string): string {
  const encoded = name.split("/").map(encodeURIComponent).join("/");
  return `/api/runs/${runId}/artifacts/${encoded}`;
}

/**
 * `--output_format=json` makes the binary print a JSON document on stdout while
 * logs stay on stderr, so a parseable stdout is the structured result. Anything
 * else is left to the caller as plain output rather than guessed at.
 */
function parseStructuredResult(stdout: string): unknown {
  const trimmed = stdout.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

function failureFor(outcome: RunOutcome): { code: string; message: string } {
  if (outcome.timedOut) {
    return {
      code: "timeout",
      message: "neuriplo-infer exceeded the configured run timeout",
    };
  }
  if (outcome.signal) {
    return {
      code: "terminated",
      message: `neuriplo-infer was terminated by ${outcome.signal}`,
    };
  }
  return {
    code: "run_failed",
    message:
      lastMeaningfulLine(outcome.stderr) ??
      `neuriplo-infer exited with code ${outcome.exitCode}`,
  };
}

function lastMeaningfulLine(stderr: string): string | null {
  const lines = stderr
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const last = lines.at(-1);
  return last ? last.slice(0, 500) : null;
}
