import type { RunResult } from "./run.js";
import { describeExecution, formatDuration, labelForStage } from "./results.js";

/**
 * Summarizing a set of runs.
 *
 * This is the repetition that can be done honestly here. `--capabilities`
 * advertises `benchmark` and `iterations`, but the run report publishes a
 * single observation with nothing per-iteration in it, so no percentile or
 * spread over a producer's own loop can be computed without inventing it —
 * that is a producer contract extension, and it is not attempted.
 *
 * What is summarized instead is N whole runs the UI launched itself. Every
 * input is a measurement someone took, and the labels must keep saying so: a
 * summary over runs is not a benchmark of one run's iterations.
 */

export type SummaryRow = {
  label: string;
  /** How many of the runs supplied this measurement. */
  count: number;
  min: string;
  median: string;
  max: string;
};

export type RunSummary = {
  runs: number;
  configuration: string;
  rows: SummaryRow[];
};

const STAGE_KEYS = [
  "model_load",
  "preprocess",
  "inference",
  "postprocess",
  "render",
] as const;

type Measurement = {
  label: string;
  of: (run: RunResult) => number | null;
  format: (value: number) => string;
};

function measurements(): Measurement[] {
  const asDuration = (value: number) => formatDuration(value);
  const rows: Measurement[] = [
    {
      label: "Wall time (whole process)",
      of: (run) => run.duration_ms,
      format: asDuration,
    },
    {
      label: "Producer wall time",
      of: (run) => run.metrics?.wall_time_ms ?? null,
      format: asDuration,
    },
  ];

  for (const stage of STAGE_KEYS) {
    rows.push({
      label: labelForStage(stage),
      of: (run) => run.metrics?.stages_ms[stage] ?? null,
      format: asDuration,
    });
  }

  rows.push({
    label: "Throughput",
    of: (run) => run.metrics?.throughput_per_second ?? null,
    format: (value) => `${value >= 100 ? value.toFixed(0) : value.toFixed(2)} /s`,
  });

  return rows;
}

/**
 * Summarizes runs of one configuration.
 *
 * Returns null unless the runs are repetitions of the same thing: aggregating
 * across different tasks, models, or executions would produce a number that
 * describes nothing. Comparison is the view for a heterogeneous set.
 *
 * Only count, minimum, median, and maximum are reported. A percentile over a
 * handful of runs would be a statistic the sample cannot support, and reporting
 * one would be inventing precision the same way a synthesized metric invents a
 * measurement.
 */
export function summarize(runs: readonly RunResult[]): RunSummary | null {
  if (runs.length < 2) return null;

  const first = runs[0];
  const homogeneous = runs.every(
    (run) =>
      run.task === first.task &&
      run.model === first.model &&
      describeExecution(run.execution) === describeExecution(first.execution),
  );
  if (!homogeneous) return null;

  const rows: SummaryRow[] = [];
  for (const measurement of measurements()) {
    // A measurement only some runs supplied is summarized over those, and the
    // row states how many produced it.
    const values = runs
      .map((run) => measurement.of(run))
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right);
    if (values.length < 2) continue;

    rows.push({
      label: measurement.label,
      count: values.length,
      min: measurement.format(values[0]),
      median: measurement.format(medianOf(values)),
      max: measurement.format(values[values.length - 1]),
    });
  }

  return {
    runs: runs.length,
    configuration: `${first.task} · ${first.model} · ${describeExecution(first.execution)}`,
    rows,
  };
}

/** Middle value, or the midpoint of the two middle values. Input is sorted. */
function medianOf(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}
