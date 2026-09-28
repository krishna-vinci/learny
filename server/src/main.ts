import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Message, TranscriptContext } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { serve } from "@hono/node-server";
import { ChatService } from "./agent/chat-service.js";
import { createModelRuntime } from "./agent/models.js";
import { createApp } from "./app.js";
import { assertBindAllowed, authConfigFromEnv } from "./auth/session.js";
import { EventHub } from "./events.js";
import { JobRunner } from "./jobs/runner.js";
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
const maxParallelJobs = Number.parseInt(process.env.STUDIUM_MAX_PARALLEL_JOBS ?? "", 10);
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
const locks = new FileLocks();
const runtime = await createModelRuntime();
const jobs = new JobRunner({
  root,
  hub,
  maxParallel: Number.isFinite(maxParallelJobs) && maxParallelJobs > 0 ? maxParallelJobs : 3,
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

const chats = new ChatService({ root, hub, locks, runtime });
const app = createApp({
  root,
  hub,
  locks,
  auth,
  chats,
  jobs,
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
