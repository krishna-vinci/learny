import { resolve } from "node:path";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const rootDir = import.meta.dirname;

const devProxyServer = process.env.DEV_PROXY_SERVER || "http://127.0.0.1:3000";

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Loopback only: the dev proxy forwards to a server that may run without a password.
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "^/api/events": {
        target: devProxyServer,
        xfwd: true,
        // SSE requires no response buffering and no timeout.
        timeout: 0,
      },
      "^/api": {
        target: devProxyServer,
        xfwd: true,
      },
    },
  },
  resolve: {
    alias: {
      "@/": `${resolve(rootDir, "src")}/`,
    },
  },
});
