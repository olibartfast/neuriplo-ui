import { filledSources, type ResolvedSelection } from "./selection.js";

// Shape of the run resource returned by POST /api/runs. Like the capabilities
// contract, only the shape lives here: the adapter builds the command line.

export type RunArtifact = {
  name: string;
  media_type: string;
  bytes: number;
  url: string;
};

/** Producer-measured timings. Every field may be absent; absent is not zero. */
export type RunStageTimings = {
  model_load: number | null;
  preprocess: number | null;
  inference: number | null;
  postprocess: number | null;
  render: number | null;
};

export type RunMetrics = {
  wall_time_ms: number | null;
  samples: number | null;
  frames: number | null;
  throughput_per_second: number | null;
  stages_ms: RunStageTimings;
};

export type RunResult = {
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
  artifacts: RunArtifact[];
  result: unknown;
  /** Null unless the binary publishes a run report; never synthesized. */
  metrics: RunMetrics | null;
  stdout: string;
  stderr: string;
  /** `stage` is the producer's own attribution, absent when it gave none. */
  error: { code: string; message: string; stage?: string | null } | null;
};

export type RunRequestBody = {
  task: string;
  model: string;
  execution: {
    workflow: string;
    backend: string | null;
    protocol: string | null;
    transport: string | null;
  };
  source: { type: string; paths: string[] };
  parameters: Record<string, string>;
};

export class RunFailedError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly field?: string,
  ) {
    super(message);
    this.name = "RunFailedError";
  }
}

/** Untouched optional fields are dropped rather than sent as empty flags. */
export function buildRunRequest(resolved: ResolvedSelection): RunRequestBody {
  const { selection } = resolved;
  const parameters: Record<string, string> = {};
  for (const [id, value] of Object.entries(selection.parameters)) {
    const trimmed = value.trim();
    if (trimmed.length > 0) parameters[id] = trimmed;
  }

  return {
    task: selection.taskId,
    model: selection.modelId,
    execution: {
      workflow: selection.workflowId,
      backend: selection.backend,
      protocol: selection.protocolId,
      transport: selection.transport,
    },
    source: { type: selection.sourceType, paths: filledSources(resolved) },
    parameters,
  };
}

export async function startRun(
  resolved: ResolvedSelection,
  signal?: AbortSignal,
): Promise<RunResult> {
  let response: Response;
  try {
    response = await fetch("/api/runs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildRunRequest(resolved)),
      signal,
    });
  } catch {
    throw new RunFailedError(
      "unreachable",
      "Could not reach the local Neuriplo adapter.",
    );
  }

  const payload = await response.json().catch(() => null);

  if (!response.ok) {
    const error =
      payload && typeof payload === "object" && "error" in payload
        ? (payload as {
            error: { code?: string; message?: string; field?: string };
          }).error
        : null;
    throw new RunFailedError(
      error?.code ?? String(response.status),
      error?.message ?? "The run could not be started.",
      error?.field,
    );
  }

  return payload as RunResult;
}
