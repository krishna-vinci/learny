import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const rootDir = import.meta.dirname;

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@/": `${resolve(rootDir, "src")}/`,
    },
  },
  test: {
    environment: "jsdom",
    globals: false,
  },
});
