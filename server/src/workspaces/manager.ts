import { promises as fs, realpathSync } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { Hono } from "hono";
import { listUsers, USERNAME_PATTERN, type User } from "../accounts/users.js";
import { ChatService } from "../agent/chat-service.js";
import { createApp } from "../app.js";
import { EventHub } from "../events.js";
import { startInboxWatcher } from "../ingest/inbox-watcher.js";
import { createCardsJob } from "../jobs/cards-job.js";
import { createDraftJob } from "../jobs/draft-job.js";
import { createIngestJob } from "../jobs/ingest-job.js";
import { loadJobHistory } from "../jobs/log.js";
import { JobRunner } from "../jobs/runner.js";
import { McpManager } from "../mcp/bridge.js";
import { loadMcpConfig } from "../mcp/config.js";
import type { Notifier } from "../notify/notifier.js";
import { commitAll, ensureRepo } from "../tree/git.js";
import { initStudyTree } from "../tree/init.js";
import { FileLocks } from "../tree/lock.js";
import { startWatcher } from "../watcher.js";

export interface WorkspaceManagerDeps {
  dataDir: string;
  db: DatabaseSync;
  runtime: ModelRuntime;
  maxParallelJobs?: number;
  subscriptionProvidersFor(root: string): Promise<readonly string[]>;
  /** When set, finished jobs notify their owner through this notifier. */
  notifier?: Notifier;
}

export interface Workspace {
  username: string;
  root: string;
  hub: EventHub;
  locks: FileLocks;
  mcp: McpManager;
  jobs: JobRunner;
  chats: ChatService;
  app: Hono;
  stop(): Promise<void>;
}

export class WorkspaceManager {
  readonly #dataDir: string;
  readonly #db: DatabaseSync;
  readonly #runtime: ModelRuntime;
  readonly #maxParallelJobs: number;
  readonly #subscriptionProvidersFor: WorkspaceManagerDeps["subscriptionProvidersFor"];
  readonly #notifier: Notifier | undefined;
  readonly #workspaces = new Map<string, Promise<Workspace>>();

  constructor(deps: WorkspaceManagerDeps) {
    this.#dataDir = deps.dataDir;
    this.#db = deps.db;
    this.#runtime = deps.runtime;
    this.#maxParallelJobs = deps.maxParallelJobs ?? 3;
    this.#subscriptionProvidersFor = deps.subscriptionProvidersFor;
    this.#notifier = deps.notifier;
  }

  async for(user: User): Promise<Workspace> {
    if (user.state === "ARCHIVED") throw new Error(`workspace for ${user.username} is archived`);
    const username = validateUsername(user.username);
    const existing = this.#workspaces.get(username);
    if (existing !== undefined) return existing;

    const created = this.#create(user);
    this.#workspaces.set(username, created);
    created.catch(() => this.#workspaces.delete(username));
    return created;
  }

  async provision(username: string, templateFromRoot?: string): Promise<string> {
    const root = await this.#initializeRoot(validateUsername(username));
    const template = templateFromRoot ?? this.#firstAdminTemplate(username);
    if (template !== undefined) {
      const source = path.resolve(template);
      for (const file of ["_global/config.yaml", "_global/mcp.json"] as const) {
        const from = path.join(source, file);
        if (!(await pathExists(from))) continue;
        const to = path.join(root, file);
        await fs.mkdir(path.dirname(to), { recursive: true });
        await fs.cp(from, to, { force: true });
      }
    }
    await ensureRepo(root);
    await commitAll(root, "system: init study tree", "system");
    return root;
  }

  rootFor(username: string): string | null {
    const validated = validateUsername(username);
    const users = path.resolve(this.#dataDir, "users");
    const root = path.resolve(users, validated);
    try {
      if (realpathSync(root) !== root) return null;
      return root;
    } catch {
      return null;
    }
  }

  isRunning(username: string): boolean {
    validateUsername(username);
    return this.#workspaces.has(username);
  }

  async startAll(): Promise<void> {
    await Promise.all(
      listUsers(this.#db)
        .filter((user) => user.state === "NORMAL")
        .map((user) => this.for(user)),
    );
  }

  async stop(username: string): Promise<void> {
    const validated = validateUsername(username);
    const workspace = this.#workspaces.get(validated);
    if (workspace === undefined) return;
    this.#workspaces.delete(validated);
    const resolved = await workspace.catch(() => undefined);
    if (resolved !== undefined) await resolved.stop();
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.#workspaces.keys()].map((username) => this.stop(username)));
  }

  #firstAdminTemplate(username: string): string | undefined {
    const admin = listUsers(this.#db).find((user) => user.role === "ADMIN" && user.username !== username);
    return admin === undefined ? undefined : (this.rootFor(admin.username) ?? undefined);
  }

  async #initializeRoot(username: string): Promise<string> {
    const users = path.resolve(this.#dataDir, "users");
    await fs.mkdir(users, { recursive: true });
    const realUsers = await fs.realpath(users);
    const root = path.resolve(realUsers, username);
    await initStudyTree(root);
    if ((await fs.realpath(root)) !== root) {
      throw new Error(`workspace root must stay inside ${realUsers}: ${username}`);
    }
    return root;
  }

  async #create(user: User): Promise<Workspace> {
    const username = user.username;
    const root = await this.#initializeRoot(username);
    await ensureRepo(root);

    const hub = new EventHub();
    const stopNotifications = this.#subscribeJobNotifications(hub, user);
    const locks = new FileLocks();
    const mcpConfig = loadMcpConfig(root, process.env);
    const mcp = new McpManager(mcpConfig.servers);
    mcp.setDisabledServers(mcpConfig.disabled);
    const jobs = new JobRunner({
      root,
      hub,
      maxParallel: this.#maxParallelJobs,
      subscriptionProviders: await this.#subscriptionProvidersFor(root),
    });
    jobs.register("draft-chapter", createDraftJob({ root, locks, mcp, runtime: this.#runtime, hub }));
    jobs.register("make-cards", createCardsJob({ root, locks, mcp, runtime: this.#runtime, hub }));
    jobs.register("ingest", createIngestJob({ root, locks, mcp, runtime: this.#runtime, hub }));
    jobs.seedHistory(await loadJobHistory(root));

    const chats = new ChatService({ root, hub, locks, mcp, runtime: this.#runtime, jobs });
    const app = createApp({
      root,
      hub,
      locks,
      chats,
      jobs,
      settings: { runtime: this.#runtime, mcp, env: process.env },
    });

    const stopWatcher = startWatcher(root, hub);
    const stopInboxWatcher = user.aiEnabled ? startInboxWatcher({ root, jobs }) : null;
    let stopped = false;
    void mcp.start();

    return {
      username,
      root,
      hub,
      locks,
      mcp,
      jobs,
      chats,
      app,
      async stop(): Promise<void> {
        if (stopped) return;
        stopped = true;
        stopNotifications();
        await stopWatcher().catch(() => undefined);
        if (stopInboxWatcher !== null) await stopInboxWatcher().catch(() => undefined);
        await mcp.stop().catch(() => undefined);
      },
    };
  }

  /** Notify the owner once when a job reaches done/failed. Failures never touch job code. */
  #subscribeJobNotifications(hub: EventHub, user: User): () => void {
    const notifier = this.#notifier;
    if (notifier === undefined) return () => undefined;
    const notified = new Set<string>();
    return hub.subscribe((event) => {
      if (event.type !== "job") return;
      const job = event.job;
      if (job.status !== "done" && job.status !== "failed") return;
      if (notified.has(job.id)) return;
      notified.add(job.id);
      const url = job.set === null ? "/jobs" : `/s/${job.set}`;
      const notification =
        job.status === "done"
          ? { title: "Job finished", body: job.title, url, event: "jobDone" as const }
          : {
              title: "Job failed",
              body: `${job.title}: ${job.error ?? "unknown error"}`,
              url,
              event: "jobFailed" as const,
            };
      void notifier.notifyUser(user.id, notification).catch(() => undefined);
    });
  }
}

function validateUsername(username: string): string {
  if (!USERNAME_PATTERN.test(username)) throw new Error("invalid workspace username");
  return username;
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
