import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { promisify } from "node:util";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createUser, type User, updateUser } from "../accounts/users.js";
import { migrate, openDb } from "../db/db.js";
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
});
