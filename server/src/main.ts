import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { assertBindAllowed, authConfigFromEnv } from "./auth/session.js";
import { EventHub } from "./events.js";
import { ensureRepo } from "./tree/git.js";
import { initStudyTree } from "./tree/init.js";
import { FileLocks } from "./tree/lock.js";
import { startWatcher } from "./watcher.js";

// pnpm runs this with server/ as cwd: resolve relative paths and .env against the repo root.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const envFile = path.join(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile); // never overrides variables already set

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const root = path.resolve(repoRoot, process.env.STUDIUM_STUDY_ROOT ?? "./data/study");
const auth = authConfigFromEnv(process.env);

try {
  assertBindAllowed(auth, host);
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));

await initStudyTree(root);
await ensureRepo(root);

const hub = new EventHub();
const app = createApp({
  root,
  hub,
  locks: new FileLocks(),
  auth,
  ...(existsSync(webDist) ? { webDist } : {}),
});

const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`studium listening on http://${host}:${info.port} (study root: ${root})`);
});

const stopWatcher = startWatcher(root, hub);

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}, shutting down`);
  await stopWatcher().catch(() => undefined);
  server.close(() => process.exit(0));
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
