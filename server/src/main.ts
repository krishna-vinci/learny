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
import { ChatService } from "./agent/chat-service.js";
import { createModelRuntime } from "./agent/models.js";
import { createApp } from "./app.js";
import { migrate, openDb } from "./db/db.js";
import { loadInstanceSecret } from "./db/secret.js";
import { EventHub } from "./events.js";
import { startInboxWatcher } from "./ingest/inbox-watcher.js";
import { createCardsJob } from "./jobs/cards-job.js";
import { createDraftJob } from "./jobs/draft-job.js";
import { createIngestJob } from "./jobs/ingest-job.js";
import { loadJobHistory } from "./jobs/log.js";
import { JobRunner } from "./jobs/runner.js";
import { McpManager } from "./mcp/bridge.js";
import { loadMcpConfig } from "./mcp/config.js";
import { createServer } from "./server.js";
import { readText } from "./tree/edit.js";
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
const dataDir = path.resolve(repoRoot, process.env.STUDIUM_DATA_DIR ?? "./data");
const maxParallelJobs = Number.parseInt(process.env.STUDIUM_MAX_PARALLEL_JOBS ?? "", 10);
const trustProxy = process.env.STUDIUM_TRUST_PROXY === "1" || process.env.STUDIUM_TRUST_PROXY === "true";
const baseUrl = process.env.STUDIUM_BASE_URL || null;

const db = openDb(path.join(dataDir, "studium.db"));
migrate(db);
const instanceSecret = loadInstanceSecret(dataDir, process.env);
const { setupRequired } = await bootstrapAccounts(db, process.env);
const localHosts = new Set(["127.0.0.1", "::1", "localhost"]);
const setupCode = setupRequired && !localHosts.has(host) ? randomBytes(6).toString("hex") : null;
if (setupCode !== null) console.log(`first-run setup code: ${setupCode} (open the app and enter it)`);

const webDist = fileURLToPath(new URL("../../web/dist", import.meta.url));

await initStudyTree(root);
await ensureRepo(root);

const hub = new EventHub();
const locks = new FileLocks();
const runtime = await createModelRuntime();
const mcpConfig = loadMcpConfig(root, process.env);
const mcp = new McpManager(mcpConfig.servers);
mcp.setDisabledServers(mcpConfig.disabled);
// Providers the learner pays a flat subscription for, used to label job billing.
const subscriptionProviders = await readText(root, "_global/config.yaml")
  .then((text) => ConfigYaml.parse(parseYaml(text)).billing?.subscription ?? [])
  .catch(() => []);
const jobs = new JobRunner({
  root,
  hub,
  maxParallel: Number.isFinite(maxParallelJobs) && maxParallelJobs > 0 ? maxParallelJobs : 3,
  subscriptionProviders,
});
jobs.register("draft-chapter", createDraftJob({ root, locks, mcp, runtime, hub }));
jobs.register("make-cards", createCardsJob({ root, locks, mcp, runtime, hub }));
jobs.register("ingest", createIngestJob({ root, locks, mcp, runtime, hub }));
jobs.seedHistory(await loadJobHistory(root));

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

const chats = new ChatService({ root, hub, locks, mcp, runtime, jobs });
const workspaceApp = createApp({
  root,
  hub,
  locks,
  chats,
  jobs,
  settings: { runtime, mcp, env: process.env },
});
const app = createServer({
  db,
  instanceSecret,
  workspaces: { for: () => ({ app: workspaceApp }) },
  authOpts: { trustProxy, baseUrl, setupCode },
  ...(existsSync(webDist) ? { webDist } : {}),
});

const server = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
  console.log(`studium listening on http://${host}:${info.port} (study root: ${root})`);
});
void mcp.start();

const stopWatcher = startWatcher(root, hub);
const stopInboxWatcher = startInboxWatcher({ root, jobs });

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`received ${signal}, shutting down`);
  await stopWatcher().catch(() => undefined);
  await stopInboxWatcher().catch(() => undefined);
  await mcp.stop().catch(() => undefined);
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
