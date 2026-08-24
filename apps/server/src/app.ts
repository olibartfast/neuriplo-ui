import Fastify, { type FastifyInstance } from "fastify";
import {
  CapabilitiesDiscoveryError,
  discoverCapabilities,
  type NeuriploCapabilities,
} from "./capabilities.js";

export type ServerOptions = {
  loadCapabilities?: () => Promise<NeuriploCapabilities>;
  logger?: boolean;
};

export function buildServer(options: ServerOptions = {}): FastifyInstance {
  const app = Fastify({ logger: options.logger ?? true });
  const loadCapabilities =
    options.loadCapabilities ?? (() => discoverCapabilities());

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

  app.post("/api/runs", async (_request, reply) => {
    return reply.code(501).send({
      status: "not_implemented",
      message: "neuriplo-infer runner integration is not implemented yet",
    });
  });

  return app;
}
