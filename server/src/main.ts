import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Message, TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { serve } from "@hono/node-server";
import { ConfigYaml } from "@studium/shared";
import { parse as parseYaml } from "yaml";
import { bootstrapAccounts } from "./accounts/bootstrap.js";
import { getUserByUsername, listUsers } from "./accounts/users.js";
import { createModelRuntime } from "./agent/models.js";
import { deriveBackupKey } from "./backups/config.js";
import { BackupScheduler, BackupService } from "./backups/scheduler.js";
import { migrate, openDb } from "./db/db.js";
import { deriveKey, loadInstanceSecret } from "./db/secret.js";
import { Notifier } from "./notify/notifier.js";
import { createServer } from "./server.js";
import { readText } from "./tree/edit.js";
import { WorkspaceManager } from "./workspaces/manager.js";
import { migrateLegacyTree } from "./workspaces/migrate-legacy.js";
import { YoutubeService } from "./youtube/service.js";

// pnpm runs this with server/ as cwd: resolve relative paths and .env against the repo root.
const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const envFile = path.join(repoRoot, ".env");
if (existsSync(envFile)) process.loadEnvFile(envFile); // never overrides variables already set

const host = process.env.HOST ?? "127.0.0.1";
const port = Number(process.env.PORT ?? 3000);
const legacyRoot = path.resolve(repoRoot, process.env.STUDIUM_STUDY_ROOT ?? "./data/study");
const dataDir = path.resolve(repoRoot, process.env.STUDIUM_DATA_DIR ?? "./data");
const maxParallelJobs = Number.parseInt(process.env.STUDIUM_MAX_PARALLEL_JOBS ?? "", 10);
const trustProxy = process.env.STUDIUM_TRUST_PROXY === "1" || process.env.STUDIUM_TRUST_PROXY === "true";
const baseUrl = process.env.STUDIUM_BASE_URL || null;

const db = openDb(path.join(dataDir, "studium.db"));
migrate(db);
const instanceSecret = loadInstanceSecret(dataDir, process.env);
const backupKey = deriveBackupKey(instanceSecret);
const notifier = new Notifier({ db, secretsKey: deriveKey(instanceSecret, "studium-secrets-v1") });
const youtube = new YoutubeService({
  dataDir,
  secretsKey: deriveKey(instanceSecret, "studium-secrets-v1"),
  env: process.env,
  notifier,
});
const { setupRequired } = await bootstrapAccounts(db, process.env);
const localHosts = new Set(["127.0.0.1", "::1", "localhost"]);
const setupCode = setupRequired && !localHosts.has(host) ? randomBytes(6).toString("hex") : null;
if (setupCode !== null) console.log(`first-run setup code: ${setupCode} (open the app and enter it)`);

const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));
const runtime = await createModelRuntime();
const firstAdmin = listUsers(db).find((user) => user.role === "ADMIN");
if (firstAdmin !== undefined) await migrateLegacyTree({ dataDir, legacyRoot, adminUsername: firstAdmin.username });

// Providers the learner pays a flat subscription for, used to label job billing.
async function subscriptionProvidersFor(root: string): Promise<readonly string[]> {
  return readText(root, "_global/config.yaml")
    .then((text) => ConfigYaml.parse(parseYaml(text)).billing?.subscription ?? [])
    .catch(() => []);
}

const workspaces = new WorkspaceManager({
  dataDir,
  db,
  runtime,
  maxParallelJobs: Number.isFinite(maxParallelJobs) && maxParallelJobs > 0 ? maxParallelJobs : 3,
  subscriptionProvidersFor,
  notifier,
  youtube,
});

const backupService = new BackupService({
  db,
  dataDir,
  key: backupKey,
  notifyAdmins: (title, body) => notifier.notifyAdmins({ title, body, url: "/settings" }),
  // Restores go through the user's workspace so they take its file locks.
  treeFor: async (username) => {
    const user = getUserByUsername(db, username);
    if (user === null || user.state !== "NORMAL") throw new Error(`unknown or archived user: ${username}`);
    const workspace = await workspaces.for(user);
    return { root: workspace.root, locks: workspace.locks };
  },
});
const backupScheduler = new BackupScheduler({
  service: backupService,
  onError: (error) => console.warn(`backup scheduler: ${error instanceof Error ? error.message : String(error)}`),
});

function messageText(message: Message): string {
  if (message.role !== "user") return "";
  if (typeof message.content === "string") return message.content;
  return message.content
    .filter((block) => block.type === "text")
    .map((block) => (block.type === "text" ? block.text : ""))
    .join("");
}

if (process.env.STUDIUM_FAUX === "1") {
  const faux = fauxProvider({ provider: "faux", models: [{ id: "echo" }] });
  const response = (context: TranscriptContext) => {
    faux.appendResponses([response]);
    let userIndex = -1;
    for (let index = context.messages.length - 1; index >= 0; index--) {
      if (context.messages[index]?.role === "user") {
        userIndex = index;
        break;
      }
    }
    const text = userIndex < 0 ? "" : messageText(context.messages[userIndex] as Message);
    const edit = /^\/faux-edit ([^|]+)\|([^|]*)\|([\s\S]*)$/.exec(text);
    const hasToolResult = context.messages.slice(userIndex + 1).some((message) => message.role === "toolResult");
    if (edit !== null && !hasToolResult) {
      return fauxAssistantMessage(
        fauxToolCall("study_edit", { path: edit[1] ?? "", old_string: edit[2] ?? "", new_string: edit[3] ?? "" }),
        { stopReason: "toolUse" },
      );
    }
    return fauxAssistantMessage(fauxText(`(faux) ${text}`));
  };
  faux.setResponses(Array.from({ length: 100 }, () => response));
  runtime.registerNativeProvider(faux.provider);
}

const app = createServer({
  version: process.env.STUDIUM_VERSION ?? "dev",
  db,
  instanceSecret,
  workspaces,
  notifier,
  authOpts: { trustProxy, baseUrl, setupCode },
  backups: { service: backupService, db, key: backupKey },
  youtube,
  ...(existsSync(webDist) ? { webDist } : {}),
});
await workspaces.startAll();

const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`studium listening on http://${host}:${info.port} (data dir: ${dataDir})`);
});
backupScheduler.start();

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}, shutting down`);
  backupScheduler.stop();
  await workspaces.stopAll().catch(() => undefined);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
