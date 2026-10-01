import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUser, type User, updateUser } from "../accounts/users.js";
import { migrate, openDb } from "../db/db.js";
import type { Notifier } from "../notify/notifier.js";
import { ensureRepo } from "../tree/git.js";
import { initStudyTree } from "../tree/init.js";
import { WorkspaceManager } from "./manager.js";

const execFileAsync = promisify(execFile);

let db: DatabaseSync;
let manager: WorkspaceManager;
let tempDir: string;
const tempDirs: string[] = [];
const runtime = {} as ModelRuntime;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-workspaces-"));
  tempDirs.push(tempDir);
  db = openDb(path.join(tempDir, "studium.db"));
  migrate(db);
  manager = new WorkspaceManager({
    dataDir: tempDir,
    db,
    runtime,
    subscriptionProvidersFor: async () => [],
  });
});

afterEach(async () => {
  await manager.stopAll();
  db.close();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

async function createNormalUser(input: Parameters<typeof createUser>[1]): Promise<User> {
  const user = await createUser(db, input);
  const created = await manager.for(user);
  const response = await created.app.request("/api/sets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title: "Private set" }),
  });
  expect(response.status).toBe(201);
  return user;
}

describe("WorkspaceManager", () => {
  it("rebuilds private search caches at startup and subscribes to file updates", async () => {
    const alice = await createUser(db, { username: "alice", role: "USER" });
    const bob = await createUser(db, { username: "bob", role: "USER" });
    const aliceRoot = await manager.provision("alice");
    await fs.mkdir(path.join(aliceRoot, "private/notes"), { recursive: true });
    await fs.writeFile(path.join(aliceRoot, "private/PLAN.md"), "---\ntitle: Private\n---\n");
    const rel = "private/notes/01.md";
    await fs.writeFile(path.join(aliceRoot, rel), "# Privatequasar\n");
    const first = await manager.for(alice);
    const second = await manager.for(bob);
    await vi.waitFor(() => expect(first.search.query({ q: "privatequasar", limit: 50 })).toHaveLength(1));
    await expect((await first.app.request("/api/search?q=privatequasar")).json()).resolves.toMatchObject({
      results: [expect.objectContaining({ path: rel })],
    });
    await expect((await second.app.request("/api/search?q=privatequasar")).json()).resolves.toEqual({ results: [] });
    await fs.writeFile(path.join(aliceRoot, rel), "# Updatedquasar\n");
    first.hub.publish({ type: "file", set: "private", path: rel, change: "change" });
    await vi.waitFor(() => expect(first.search.query({ q: "updatedquasar", limit: 50 })).toHaveLength(1));
    expect(first.search.query({ q: "privatequasar", limit: 50 })).toEqual([]);
    await fs.rm(path.join(aliceRoot, rel));
    first.hub.publish({ type: "file", set: "private", path: rel, change: "unlink" });
    await vi.waitFor(() => expect(first.search.query({ q: "updatedquasar", limit: 50 })).toEqual([]));
    await manager.stop("alice");
    first.hub.publish({ type: "file", set: "private", path: rel, change: "change" });
    expect(() => first.search.query({ q: "quasar", limit: 50 })).toThrow();
  });

  it("isolates each user's study tree", async () => {
    const first = await createNormalUser({ username: "alice", role: "USER" });
    const second = await createUser(db, { username: "bob", role: "USER" });
    const firstWorkspace = await manager.for(first);
    const secondWorkspace = await manager.for(second);

    expect(path.relative(tempDir, firstWorkspace.root)).toBe(path.join("users", "alice"));
    expect(path.relative(tempDir, secondWorkspace.root)).toBe(path.join("users", "bob"));
    const firstSets = (await (await firstWorkspace.app.request("/api/sets")).json()) as Array<{ slug: string }>;
    expect(firstSets.map((set) => set.slug)).toEqual(["private-set"]);
    await expect((await secondWorkspace.app.request("/api/sets")).json()).resolves.toEqual([]);
  });

  it("provisions a tree with the first admin's global configuration", async () => {
    await createUser(db, { username: "admin", role: "ADMIN" });
    const template = path.join(tempDir, "template");
    await initStudyTree(template);
    await ensureRepo(template);
    await fs.writeFile(path.join(template, "_global", "config.yaml"), "models:\n  default: test/model\n  roles: {}\n");
    await fs.writeFile(path.join(template, "_global", "mcp.json"), "{}\n");

    const root = await manager.provision("learner", template);
    await expect(fs.readFile(path.join(root, "_global", "config.yaml"), "utf8")).resolves.toContain("test/model");
    await expect(fs.readFile(path.join(root, "_global", "mcp.json"), "utf8")).resolves.toBe("{}\n");
    const subject = (await execFileAsync("git", ["-C", root, "log", "-1", "--pretty=%s"])).stdout.trim();
    expect(subject).toBe("system: init study tree");
  });

  it("stops an archived user's workspace", async () => {
    const user = await createNormalUser({ username: "learner", role: "USER" });
    expect(manager.isRunning(user.username)).toBe(true);
    updateUser(db, user.id, { state: "ARCHIVED" });
    await manager.stop(user.username);
    expect(manager.isRunning(user.username)).toBe(false);
  });

  it("notifies the owner once when a job finishes", async () => {
    let deliver: (call: { userId: number; notification: unknown }) => void = () => undefined;
    const notified = new Promise<{ userId: number; notification: unknown }>((resolve) => {
      deliver = resolve;
    });
    const notifier = {
      notifyUser: async (userId: number, notification: unknown) => {
        deliver({ userId, notification });
      },
      notifyAdmins: async () => undefined,
    } as unknown as Notifier;
    manager = new WorkspaceManager({
      dataDir: tempDir,
      db,
      runtime,
      subscriptionProvidersFor: async () => [],
      notifier,
    });

    const user = await createUser(db, { username: "learner", role: "USER" });
    const workspace = await manager.for(user);
    workspace.jobs.register("draft-chapter", async () => undefined);
    workspace.jobs.enqueue("draft-chapter", {}, { set: "linear-algebra", title: "Chapter one" });

    const call = await notified;
    expect(call.userId).toBe(user.id);
    expect(call.notification).toMatchObject({
      title: "Job finished",
      url: "/s/linear-algebra",
      event: "jobDone",
    });
  });
});

it("reads AI authorization from the DB at enqueue time for an existing workspace", async () => {
  const user = await createUser(db, { username: "learner", role: "USER" });
  const workspace = await manager.for(user);
  workspace.jobs.register("draft-chapter", async () => undefined);
  updateUser(db, user.id, { aiEnabled: false });
  expect(() => workspace.jobs.enqueue("draft-chapter", {}, { set: null, title: "denied" })).toThrow(
    "AI features are disabled for this account",
  );
  updateUser(db, user.id, { aiEnabled: true });
  const job = workspace.jobs.enqueue("draft-chapter", {}, { set: null, title: "allowed" });
  await vi.waitFor(() => expect(workspace.jobs.get(job.id)?.status).toBe("done"));
});
