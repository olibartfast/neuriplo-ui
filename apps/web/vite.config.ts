import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const adapter = process.env.NEURIPLO_UI_API ?? "http://127.0.0.1:5174";
const proxy = { "/api": { target: adapter, changeOrigin: true } };

/**
 * Loopback, unless someone deliberately asks otherwise.
 *
 * This server proxies `/api` to an adapter that browses and reads the
 * filesystem of the machine it runs on and spawns processes there. Bound to
 * `0.0.0.0`, anyone on the same network gets that, unauthenticated — which is
 * the finding the E2E preview server already had to fix.
 *
 * `NEURIPLO_UI_HOST=0.0.0.0 npm run dev` still exposes it, for a container or
 * a remote workstation, but it now has to be asked for.
 */
const host = process.env.NEURIPLO_UI_HOST?.trim() || "127.0.0.1";

export default defineConfig({
  plugins: [react()],
  server: { host, port: 5173, proxy },
  // Preview needs the same proxy as the dev server: the E2E harness serves the
  // built frontend, and the adapter still answers on its own origin.
  preview: { host, port: 5173, proxy },
});
