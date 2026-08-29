// Presentation helpers for a terminal run, kept pure and task-neutral so the
// frontend never grows a per-task result registry. Nothing here inspects the
// meaning of a result: it formats what the adapter already reported.

import type { RunMetrics, RunResult } from "./run.js";

/**
 * Adapter-observed wall time in stable units. This is the whole child process
 * — startup, model load, inference, rendering, shutdown — so callers must
 * label it wall time and never inference latency.
 */
export function formatDuration(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return "—";
  // Per-stage timings are routinely single-digit milliseconds, where rounding
  // to a whole millisecond throws away most of the measurement.
  if (milliseconds < 10) return `${Number(milliseconds.toFixed(1))} ms`;
  if (milliseconds < 1000) return `${Math.round(milliseconds)} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1000).toFixed(2)} s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = (milliseconds - minutes * 60_000) / 1000;
  return `${minutes} min ${seconds.toFixed(1)} s`;
}

const SHELL_SAFE = /^[A-Za-z0-9_@%+=:,./-]+$/;

/**
 * POSIX single-quote quoting: everything inside single quotes is literal, and
 * an embedded quote is closed, escaped, and reopened. An empty argument still
 * has to reach the binary, so it becomes an explicit empty pair.
 */
export function quoteShellArgument(value: string): string {
  if (value.length === 0) return "''";
  if (SHELL_SAFE.test(value)) return value;
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

/**
 * The reproducible command. It is built from the arguments the adapter
 * actually spawned, never rebuilt from the form, so what the UI shows is what
 * ran.
 */
export function formatCommand(command: {
  bin: string;
  args: string[];
}): string {
  return [command.bin, ...command.args].map(quoteShellArgument).join(" ");
}

/** Indented JSON with the producer's values untouched. */
export function formatJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2);
  return text === undefined ? String(value) : text;
}

export type OutcomeInput = {
  exit_code: number | null;
  signal: string | null;
  timed_out: boolean;
  duration_ms: number;
  artifacts: readonly unknown[];
};

/**
 * A short factual summary of how the process ended. Timeout and signal
 * termination are named rather than reduced to a missing exit code.
 */
export function summarizeOutcome(outcome: OutcomeInput): string[] {
  const artifacts = outcome.artifacts.length;
  const ending = outcome.timed_out
    ? "timed out"
    : outcome.signal
      ? `terminated by ${outcome.signal}`
      : outcome.exit_code === null
        ? "exit unknown"
        : `exit ${outcome.exit_code}`;

  return [
    ending,
    `${formatDuration(outcome.duration_ms)} wall time`,
    `${artifacts} artifact${artifacts === 1 ? "" : "s"}`,
  ];
}

/** Execution workflow plus whichever of backend or protocol/transport applies. */
export function describeExecution(execution: RunResult["execution"]): string {
  const parts = [execution.workflow];
  if (execution.backend) parts.push(execution.backend);
  if (execution.protocol) {
    parts.push(
      execution.transport
        ? `${execution.protocol}/${execution.transport}`
        : execution.protocol,
    );
  }
  return parts.join(" · ");
}

export type CopyState =
  | { status: "idle" }
  | { status: "copied" }
  | { status: "failed"; message: string };

type ClipboardLike = { writeText: (text: string) => Promise<void> };

/**
 * Copying never destroys the visible command: a browser without clipboard
 * access, or one that rejects the write, leaves the text selectable and says
 * so instead of failing silently.
 */
export async function copyText(
  text: string,
  clipboard: ClipboardLike | undefined,
): Promise<CopyState> {
  if (!clipboard || typeof clipboard.writeText !== "function") {
    return {
      status: "failed",
      message:
        "Clipboard access is unavailable; select the command to copy it.",
    };
  }
  try {
    await clipboard.writeText(text);
    return { status: "copied" };
  } catch {
    return {
      status: "failed",
      message: "The clipboard rejected the copy; select the command instead.",
    };
  }
}

/** A stage label from the producer's vocabulary, rendered for a reader. */
export function labelForStage(stage: string): string {
  return stage
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export type MetricRow = { label: string; value: string };

/**
 * The producer's measurements, formatted for display.
 *
 * Only measured values produce a row. A build that publishes no metrics, or a
 * run that measured nothing, yields an empty list, and the caller shows no
 * metrics section rather than a panel of dashes.
 */
export function metricRows(metrics: RunMetrics | null): MetricRow[] {
  if (!metrics) return [];

  const rows: MetricRow[] = [];
  if (metrics.wall_time_ms !== null) {
    rows.push({
      label: "Producer wall time",
      value: formatDuration(metrics.wall_time_ms),
    });
  }
  for (const [key, value] of Object.entries(metrics.stages_ms)) {
    if (value === null) continue;
    rows.push({ label: labelForStage(key), value: formatDuration(value) });
  }
  if (metrics.samples !== null) {
    rows.push({ label: "Samples", value: String(metrics.samples) });
  }
  if (metrics.frames !== null) {
    rows.push({ label: "Frames", value: String(metrics.frames) });
  }
  if (metrics.throughput_per_second !== null) {
    // The producer defines what it counted; the unit stays generic because a
    // sample is not always a frame.
    rows.push({
      label: "Throughput",
      value: `${formatThroughput(metrics.throughput_per_second)} /s`,
    });
  }
  return rows;
}

function formatThroughput(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return value >= 100 ? value.toFixed(0) : value.toFixed(2);
}
