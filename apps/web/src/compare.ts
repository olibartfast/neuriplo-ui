import type { RunResult } from "./run.js";
import { describeExecution, formatDuration, labelForStage } from "./results.js";

/**
 * Putting runs side by side.
 *
 * This module answers one question — what differed between these runs — and
 * deliberately refuses the next one. It computes no speedup, names no winner,
 * and normalizes nothing across machines: two runs on different executions
 * differ in ways the numbers alone do not explain, and asserting otherwise
 * would be the same mistake as calling wall time inference latency.
 *
 * Difference is decided on the raw values and only then formatted, so two
 * measurements that round to the same display string are still reported as
 * different.
 */

export type ComparisonCell = {
  /** Formatted for display; "—" where the run has no such value. */
  text: string;
  /** True when this run supplied no value at all. */
  absent: boolean;
};

export type ComparisonRow = {
  label: string;
  cells: ComparisonCell[];
  /** True when the runs did not all report the same raw value. */
  differs: boolean;
};

type Extractor = {
  label: string;
  /** Raw value used for equality; null means the run has none. */
  value: (run: RunResult) => string | number | null;
  format?: (value: string | number) => string;
};

const STAGE_KEYS = [
  "model_load",
  "preprocess",
  "inference",
  "postprocess",
  "render",
] as const;

/**
 * Rows in a fixed order: what the run was, how it ended, then what was
 * measured — the adapter's own wall time first, kept separate from the
 * producer's, exactly as the run panel keeps them.
 */
function extractors(): Extractor[] {
  const rows: Extractor[] = [
    { label: "Status", value: (run) => (run.status === "success" ? "Succeeded" : "Failed") },
    { label: "Task", value: (run) => run.task },
    { label: "Model", value: (run) => run.model },
    { label: "Execution", value: (run) => describeExecution(run.execution) },
    { label: "Exit", value: (run) => run.exit_code, format: String },
    {
      label: "Wall time (whole process)",
      value: (run) => run.duration_ms,
      format: (value) => formatDuration(Number(value)),
    },
    {
      label: "Producer wall time",
      value: (run) => run.metrics?.wall_time_ms ?? null,
      format: (value) => formatDuration(Number(value)),
    },
  ];

  for (const stage of STAGE_KEYS) {
    rows.push({
      label: labelForStage(stage),
      value: (run) => run.metrics?.stages_ms[stage] ?? null,
      format: (value) => formatDuration(Number(value)),
    });
  }

  rows.push(
    { label: "Samples", value: (run) => run.metrics?.samples ?? null, format: String },
    { label: "Frames", value: (run) => run.metrics?.frames ?? null, format: String },
    {
      label: "Throughput",
      value: (run) => run.metrics?.throughput_per_second ?? null,
      format: (value) => `${Number(value) >= 100 ? Number(value).toFixed(0) : Number(value).toFixed(2)} /s`,
    },
    { label: "Artifacts", value: (run) => run.artifacts.length, format: String },
    {
      label: "Failure stage",
      value: (run) => run.error?.stage ?? null,
      format: (value) => labelForStage(String(value)),
    },
  );

  return rows;
}

/**
 * Builds the comparison table.
 *
 * A row every run left empty is dropped: a measurement nobody took is not a
 * similarity worth a line. A row some runs have and others do not is kept and
 * marked as differing, because that absence is itself the difference.
 */
export function compareRuns(runs: readonly RunResult[]): ComparisonRow[] {
  if (runs.length < 2) return [];

  const rows: ComparisonRow[] = [];
  for (const extractor of extractors()) {
    const values = runs.map((run) => extractor.value(run));
    if (values.every((value) => value === null)) continue;

    rows.push({
      label: extractor.label,
      differs: new Set(values.map((value) => JSON.stringify(value))).size > 1,
      cells: values.map((value) => ({
        absent: value === null,
        text:
          value === null
            ? "—"
            : extractor.format
              ? extractor.format(value)
              : String(value),
      })),
    });
  }

  return rows;
}

/** A short caption naming what is being compared, without interpreting it. */
export function describeComparison(runs: readonly RunResult[]): string {
  const executions = new Set(runs.map((run) => run.execution.workflow));
  const models = new Set(runs.map((run) => run.model));
  const backends = new Set(
    runs.map((run) => run.execution.backend).filter((backend) => backend !== null),
  );

  const varying: string[] = [];
  if (executions.size > 1) varying.push("execution");
  if (models.size > 1) varying.push("model");
  if (backends.size > 1) varying.push("backend");

  if (varying.length === 0) {
    return `${runs.length} runs of the same configuration.`;
  }
  return `${runs.length} runs differing in ${varying.join(" and ")}.`;
}
