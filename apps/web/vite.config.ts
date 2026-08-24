import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const adapter = process.env.NEURIPLO_UI_API ?? "http://127.0.0.1:5174";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target: adapter, changeOrigin: true },
    },
  },
});
