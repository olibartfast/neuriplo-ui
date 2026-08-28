import { readFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";
import type { CapabilityRunReport } from "./capabilities.js";

/**
 * Reads the diagnostics document a run leaves behind.
 *
 * The producer measures its own stages and attributes its own failures; the
 * adapter only validates the shape and passes it through. Nothing here infers
 * a stage or a duration from logs, and nothing substitutes a zero for a
 * measurement the producer did not take: a value that is absent stays absent
 * all the way to the browser.
 */

export type RunStageTimings = {
  model_load: number | null;
  preprocess: number | null;
  inference: number | null;
  postprocess: number | null;
  render: number | null;
};

export type RunMetrics = {
  /** Producer-measured, and smaller than the adapter's process wall time. */
  wall_time_ms: number | null;
  samples: number | null;
  frames: number | null;
  throughput_per_second: number | null;
  /** Sum per stage over the whole run, in milliseconds. */
  stages_ms: RunStageTimings;
};

export type RunDiagnostics = {
  schema_version: number;
  status: "success" | "failed" | null;
  stage: string | null;
  metrics: RunMetrics | null;
  error: { stage: string | null; message: string | null } | null;
};

const STAGE_KEYS = [
  "model_load",
  "preprocess",
  "inference",
  "postprocess",
  "render",
] as const;

/**
 * Loads the advertised report from a finished run's directory.
 *
 * Returns null whenever the report is missing, unreadable, not JSON, of an
 * unsupported version, or malformed. A run is not less successful because its
 * diagnostics could not be read, so no failure here is ever propagated.
 */
export async function readRunDiagnostics(
  directory: string,
  contract: CapabilityRunReport | null,
): Promise<RunDiagnostics | null> {
  if (!contract) return null;

  const path = reportPathWithin(directory, contract.path);
  if (!path) return null;

  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    return null; // A run that never got far enough to write one.
  }

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return null;
  }

  return parseRunDiagnostics(payload, contract.schema_version);
}

/** Confines the advertised path to the run directory, symlinks aside. */
function reportPathWithin(directory: string, name: string): string | null {
  const root = resolve(directory);
  const target = resolve(root, name);
  const inside = relative(root, target);
  if (inside.length === 0 || inside.startsWith("..") || isAbsolute(inside)) {
    return null;
  }
  return target;
}

export function parseRunDiagnostics(
  payload: unknown,
  advertisedVersion: number,
): RunDiagnostics | null {
  if (!isRecord(payload)) return null;
  if (typeof payload.schema_version !== "number") return null;
  // A document from a newer contract may have changed meaning, and guessing
  // which half still applies is exactly what a version exists to prevent.
  if (payload.schema_version !== advertisedVersion) return null;

  const status =
    payload.status === "success" || payload.status === "failed"
      ? payload.status
      : null;

  return {
    schema_version: payload.schema_version,
    status,
    stage: typeof payload.stage === "string" ? payload.stage : null,
    metrics: parseMetrics(payload.metrics),
    error: parseError(payload.error),
  };
}

function parseMetrics(value: unknown): RunMetrics | null {
  if (!isRecord(value)) return null;

  const stagesSource = isRecord(value.stages_ms) ? value.stages_ms : {};
  const stages = {} as RunStageTimings;
  for (const key of STAGE_KEYS) {
    stages[key] = finiteOrNull(stagesSource[key]);
  }

  const metrics: RunMetrics = {
    wall_time_ms: finiteOrNull(value.wall_time_ms),
    samples: finiteOrNull(value.samples),
    frames: finiteOrNull(value.frames),
    throughput_per_second: finiteOrNull(value.throughput_per_second),
    stages_ms: stages,
  };

  // A metrics object in which nothing was measured carries no information, and
  // showing an empty panel is worse than showing none.
  const measured =
    metrics.wall_time_ms !== null ||
    metrics.samples !== null ||
    metrics.frames !== null ||
    metrics.throughput_per_second !== null ||
    STAGE_KEYS.some((key) => stages[key] !== null);

  return measured ? metrics : null;
}

function parseError(
  value: unknown,
): { stage: string | null; message: string | null } | null {
  if (!isRecord(value)) return null;
  return {
    stage: typeof value.stage === "string" ? value.stage : null,
    message: typeof value.message === "string" ? value.message : null,
  };
}

/** Anything not a finite number — null, a string, NaN — is "not measured". */
function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
