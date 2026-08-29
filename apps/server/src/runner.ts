import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join, relative, resolve } from "node:path";

/**
 * Executes `neuriplo-infer` in a private working directory.
 *
 * The binary writes its rendered output relative to the current directory
 * (`data/output/...`), so giving every run its own directory is what makes the
 * generated artifacts both discoverable and safe to serve: anything inside the
 * directory belongs to that run, and nothing outside it is reachable.
 */

export type RunArtifact = {
  /** Path relative to the run directory, always with forward slashes. */
  name: string;
  media_type: string;
  bytes: number;
};

export type RunOutcome = {
  runId: string;
  directory: string;
  args: string[];
  binaryPath: string;
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  artifacts: RunArtifact[];
};

export type RunExecutionErrorCode = "not_configured" | "spawn_failed";

export class RunExecutionError extends Error {
  constructor(
    readonly code: RunExecutionErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "RunExecutionError";
  }
}

export type RunnerOptions = {
  binaryPath?: string;
  runRoot?: string;
  timeoutMs?: number;
  maxOutputBytes?: number;
};

const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_MAX_OUTPUT_BYTES = 1024 * 1024;
const RUN_ID_PATTERN = /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/;

export function runRootFor(options: RunnerOptions = {}): string {
  return resolve(
    options.runRoot ??
      process.env.NEURIPLO_UI_RUN_ROOT ??
      join(tmpdir(), "neuriplo-ui-runs"),
  );
}

export async function executeRun(
  args: string[],
  options: RunnerOptions = {},
): Promise<RunOutcome> {
  const binaryPath = (
    options.binaryPath ??
    process.env.NEURIPLO_INFER_BIN ??
    ""
  ).trim();
  if (!binaryPath) {
    throw new RunExecutionError(
      "not_configured",
      "NEURIPLO_INFER_BIN is not configured",
    );
  }

  const timeoutMs =
    options.timeoutMs ??
    Number(process.env.NEURIPLO_UI_RUN_TIMEOUT_MS ?? DEFAULT_TIMEOUT_MS);
  const maxOutputBytes = options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;

  const runId = randomUUID();
  const directory = join(runRootFor(options), runId);
  await mkdir(directory, { recursive: true });

  const stdout = collector(maxOutputBytes);
  const stderr = collector(maxOutputBytes);
  const startedAt = process.hrtime.bigint();

  const outcome = await new Promise<{
    exitCode: number | null;
    signal: NodeJS.Signals | null;
    timedOut: boolean;
  }>((resolvePromise, rejectPromise) => {
    const child = spawn(binaryPath, args, {
      cwd: directory,
      // glog keeps INFO records in files under /tmp unless told otherwise;
      // routing everything to stderr is what lets the adapter return the log.
      env: { GLOG_logtostderr: "1", ...process.env },
      windowsHide: true,
    });

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));

    child.on("error", (error) => {
      clearTimeout(timer);
      rejectPromise(
        new RunExecutionError(
          "spawn_failed",
          `Failed to execute ${binaryPath}`,
          { cause: error },
        ),
      );
    });

    child.on("close", (code, signal) => {
      clearTimeout(timer);
      resolvePromise({ exitCode: code, signal, timedOut });
    });
  });

  const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;

  return {
    runId,
    directory,
    args,
    binaryPath,
    exitCode: outcome.exitCode,
    signal: outcome.signal,
    timedOut: outcome.timedOut,
    durationMs: Math.round(durationMs * 1000) / 1000,
    stdout: stdout.text(),
    stderr: stderr.text(),
    artifacts: await collectArtifacts(directory),
  };
}

/** Absolute path of an artifact, or null when it escapes the run directory. */
export function resolveArtifactPath(
  runId: string,
  name: string,
  options: RunnerOptions = {},
): string | null {
  if (!RUN_ID_PATTERN.test(runId)) return null;

  const directory = join(runRootFor(options), runId);
  const target = resolve(directory, name);
  const inside = relative(directory, target);
  if (inside.length === 0 || inside.startsWith("..") || isAbsolute(inside)) {
    return null;
  }
  return target;
}

async function collectArtifacts(
  directory: string,
  prefix = "",
): Promise<RunArtifact[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const artifacts: RunArtifact[] = [];

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const name = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = join(directory, entry.name);

    if (entry.isDirectory()) {
      artifacts.push(...(await collectArtifacts(absolute, name)));
      continue;
    }
    if (!entry.isFile()) continue;

    const stats = await stat(absolute).catch(() => null);
    if (!stats) continue;
    artifacts.push({
      name,
      media_type: mediaTypeFor(entry.name),
      bytes: stats.size,
    });
  }

  return artifacts;
}

const MEDIA_TYPES: Record<string, string> = {
  avi: "video/x-msvideo",
  bmp: "image/bmp",
  csv: "text/csv",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  json: "application/json",
  log: "text/plain",
  mp4: "video/mp4",
  png: "image/png",
  ppm: "image/x-portable-pixmap",
  txt: "text/plain",
  webm: "video/webm",
  webp: "image/webp",
};

export function mediaTypeFor(fileName: string): string {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "";
  return MEDIA_TYPES[extension] ?? "application/octet-stream";
}

/** Buffers output up to a byte budget so a chatty run cannot exhaust memory. */
function collector(limit: number) {
  const chunks: Buffer[] = [];
  let size = 0;
  let truncated = false;

  return {
    push(chunk: Buffer) {
      const room = limit - size;
      if (room <= 0) {
        truncated = true;
        return;
      }
      if (chunk.length > room) {
        chunks.push(chunk.subarray(0, room));
        size = limit;
        truncated = true;
        return;
      }
      chunks.push(chunk);
      size += chunk.length;
    },
    text(): string {
      const text = Buffer.concat(chunks).toString("utf8");
      return truncated ? `${text}\n[output truncated at ${limit} bytes]` : text;
    },
  };
}
