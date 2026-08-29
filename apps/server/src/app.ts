import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import Fastify, { type FastifyInstance } from "fastify";
import {
  CapabilitiesDiscoveryError,
  discoverCapabilities,
  runReportContract,
  type NeuriploCapabilities,
} from "./capabilities.js";
import {
  FileBrowseError,
  listDirectory,
  type BrowseOptions,
  type DirectoryListing,
} from "./files.js";
import {
  RemoteMetadataError,
  fetchRemoteMetadata,
  type RemoteOptions,
} from "./remote.js";
import { buildRunResponse } from "./runResponse.js";
import { readRunDiagnostics } from "./runReport.js";
import {
  RunExecutionError,
  executeRun,
  mediaTypeFor,
  resolveArtifactPath,
  type RunOutcome,
  type RunnerOptions,
} from "./runner.js";
import { RunRequestError, planRun } from "./runs.js";

export type ServerOptions = {
  loadCapabilities?: () => Promise<NeuriploCapabilities>;
  runInference?: (args: string[]) => Promise<RunOutcome>;
  runner?: RunnerOptions;
  browse?: BrowseOptions;
  remote?: RemoteOptions;
  logger?: boolean;
};

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  const loadCapabilities =
    options.loadCapabilities ?? (() => discoverCapabilities());
  const runner = options.runner ?? {};
  const runInference =
    options.runInference ?? ((args: string[]) => executeRun(args, runner));
  const browse = options.browse ?? {};
  const remote = options.remote ?? {};

  app.get("/api/health", async () => ({ status: "ok" }));

  app.get("/api/capabilities", async (_request, reply) => {
    try {
      return await loadCapabilities();
    } catch (error) {
      if (!(error instanceof CapabilitiesDiscoveryError)) {
        throw error;
      }

      app.log.error({ err: error }, "Capability discovery failed");
      const statusCode = error.code === "not_configured" ? 503 : 502;
      return reply.code(statusCode).send({
        status: "unavailable",
        error: {
          code: error.code,
          message: error.message,
        },
      });
    }
  });

  app.post("/api/runs", async (request, reply) => {
    let capabilities: NeuriploCapabilities;
    try {
      capabilities = await loadCapabilities();
    } catch (error) {
      if (!(error instanceof CapabilitiesDiscoveryError)) throw error;
      app.log.error({ err: error }, "Capability discovery failed");
      return reply
        .code(error.code === "not_configured" ? 503 : 502)
        .send(failure(error.code, error.message));
    }

    try {
      const plan = planRun(capabilities, request.body);
      const outcome = await runInference(plan.args);
      // Diagnostics live in the run's own directory, at the path the contract
      // advertises; a build that publishes none simply yields null.
      const diagnostics = await readRunDiagnostics(
        outcome.directory,
        runReportContract(capabilities),
      );
      return buildRunResponse(plan, outcome, diagnostics);
    } catch (error) {
      if (error instanceof RunRequestError) {
        return reply
          .code(400)
          .send(failure(error.code, error.message, error.field));
      }
      if (error instanceof RunExecutionError) {
        app.log.error({ err: error }, "Run execution failed");
        return reply
          .code(error.code === "not_configured" ? 503 : 502)
          .send(failure(error.code, error.message));
      }
      throw error;
    }
  });

  // The picker browses the adapter's filesystem because a browser file input
  // yields a name, not a path, and the binary needs a path on this machine.
  app.get<{ Querystring: { path?: string } }>(
    "/api/files",
    async (request, reply) => {
      try {
        const listing: DirectoryListing = await listDirectory(
          request.query.path,
          browse,
        );
        return listing;
      } catch (error) {
        if (!(error instanceof FileBrowseError)) throw error;
        return reply
          .code(FILE_BROWSE_STATUS[error.code])
          .send(failure(error.code, error.message, "path"));
      }
    },
  );

  // The only place the adapter fetches a URL the browser supplied, which is
  // why the endpoint is checked against an allowlist before anything connects.
  app.get<{
    Querystring: { endpoint?: string; model?: string; version?: string };
  }>("/api/remote/metadata", async (request, reply) => {
    const endpoint = request.query.endpoint?.trim();
    if (!endpoint) {
      return reply
        .code(400)
        .send(failure("invalid_endpoint", "An endpoint is required", "endpoint"));
    }

    try {
      return await fetchRemoteMetadata(
        endpoint,
        request.query.model ?? null,
        request.query.version ?? null,
        remote,
      );
    } catch (error) {
      if (!(error instanceof RemoteMetadataError)) throw error;
      app.log.warn({ err: error }, "Remote metadata lookup failed");
      return reply
        .code(REMOTE_STATUS[error.code])
        .send(failure(error.code, error.message, "endpoint"));
    }
  });

  // Artifacts are addressed relative to their run directory, and the path is
  // re-resolved against that directory so a traversal attempt resolves outside
  // it and is rejected rather than served.
  app.get<{ Params: { runId: string; "*": string } }>(
    "/api/runs/:runId/artifacts/*",
    async (request, reply) => {
      const target = resolveArtifactPath(
        request.params.runId,
        request.params["*"],
        runner,
      );
      if (!target) {
        return reply.code(404).send(failure("not_found", "Unknown artifact"));
      }

      const stats = await stat(target).catch(() => null);
      if (!stats?.isFile()) {
        return reply.code(404).send(failure("not_found", "Unknown artifact"));
      }

      return reply
        .type(mediaTypeFor(target))
        .header("content-length", String(stats.size))
        .send(createReadStream(target));
    },
  );

  return app;
}

const REMOTE_STATUS: Record<RemoteMetadataError["code"], number> = {
  forbidden_endpoint: 403,
  invalid_endpoint: 400,
  invalid_response: 502,
  unreachable: 502,
};

const FILE_BROWSE_STATUS: Record<FileBrowseError["code"], number> = {
  forbidden: 403,
  not_a_directory: 400,
  not_found: 404,
  unreadable: 500,
};

function failure(code: string, message: string, field?: string) {
  return {
    status: "error" as const,
    error: field ? { code, message, field } : { code, message },
  };
}
