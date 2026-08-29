import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const adapter = process.env.NEURIPLO_UI_API ?? "http://127.0.0.1:5174";
const proxy = { "/api": { target: adapter, changeOrigin: true } };

export default defineConfig({
  plugins: [react()],
  server: { port: 5173, proxy },
  // Preview needs the same proxy as the dev server: the E2E harness serves the
  // built frontend, and the adapter still answers on its own origin.
  preview: { port: 5173, proxy },
});
