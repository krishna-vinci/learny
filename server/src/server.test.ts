import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession, listSessions } from "./accounts/sessions.js";
import { createAccessToken } from "./accounts/tokens.js";
import { createUser, verifyUserPassword } from "./accounts/users.js";
import { migrate, openDb } from "./db/db.js";
import { createServer } from "./server.js";

let db: DatabaseSync;
let workspace: Hono;
let tempDir: string;
let provisioned: string[] = [];
let stopped: string[] = [];
let roots: Record<string, string> = {};
const tempDirs: string[] = [];

beforeEach(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-server-"));
  tempDir = dir;
  tempDirs.push(dir);
  db = openDb(path.join(dir, "studium.db"));
  migrate(db);
  workspace = new Hono();
  workspace.get("/api/sets", (c) => c.json([{ slug: "sample" }]));
  workspace.post("*", (c) => c.json({ ok: true }, 202));
  provisioned = [];
  stopped = [];
  roots = {};
});

afterEach(async () => {
  db.close();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function server(webDist?: string): Hono {
  return createServer({
    db,
    instanceSecret: Buffer.alloc(32, 1),
    workspaces: {
      for: async () => ({ app: workspace }),
      provision: async (username) => {
        provisioned.push(username);
      },
      stop: async (username) => {
        stopped.push(username);
      },
      rootFor: (username) => roots[username] ?? null,
    },
    authOpts: { trustProxy: false, baseUrl: null, setupCode: null },
    ...(webDist === undefined ? {} : { webDist }),
  });
}

function cookie(token: string): Record<string, string> {
  return { cookie: `studium_session=${token}` };
}

describe("top-level server", () => {
  it("requires a session for workspace routes and accepts a PAT bearer", async () => {
    const user = await createUser(db, { username: "learner", role: "USER" });
    const pat = createAccessToken(db, user.id, { description: "test" });
    const app = server();
    const unauthorized = await app.request("/api/sets");
    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({ error: "unauthorized" });
    const authorized = await app.request("/api/sets", { headers: { authorization: `Bearer ${pat.token}` } });
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toEqual([{ slug: "sample" }]);
  });

  it("protects the last active admin from demotion and archival", async () => {
    const admin = await createUser(db, { username: "admin", password: "admin-pass", role: "ADMIN" });
    const session = createSession(db, admin.id, { userAgent: "", ip: "" });
    const app = server();
    for (const patch of [{ role: "USER" }, { state: "ARCHIVED" }]) {
      const response = await app.request(`/api/admin/users/${admin.id}`, {
        method: "PATCH",
        headers: { ...cookie(session.token), "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: "cannot remove the last admin" });
    }
  });

  it("provisions created users and rejects traversal usernames", async () => {
    const admin = await createUser(db, { username: "admin", password: "admin-pass", role: "ADMIN" });
    const session = createSession(db, admin.id, { userAgent: "", ip: "" });
    const app = server();
    const created = await app.request("/api/admin/users", {
      method: "POST",
      headers: { ...cookie(session.token), "content-type": "application/json" },
      body: JSON.stringify({ username: "bob", password: "bob-password", role: "USER" }),
    });
    expect(created.status).toBe(201);
    expect(provisioned).toEqual(["bob"]);

    const traversal = await app.request("/api/admin/users", {
      method: "POST",
      headers: { ...cookie(session.token), "content-type": "application/json" },
      body: JSON.stringify({ username: "../evil", password: "evil-password", role: "USER" }),
    });
    expect(traversal.status).toBe(400);
    expect(provisioned).toEqual(["bob"]);
  });

  it("stops workspaces on archive and moves a purged tree to trash", async () => {
    const admin = await createUser(db, { username: "admin", password: "admin-pass", role: "ADMIN" });
    const learner = await createUser(db, { username: "learner", password: "learner-pass", role: "USER" });
    const adminSession = createSession(db, admin.id, { userAgent: "", ip: "" });
    const root = path.join(tempDir, "users", "learner");
    roots.learner = root;
    await fs.mkdir(root, { recursive: true });
    const app = server();

    const archived = await app.request(`/api/admin/users/${learner.id}`, {
      method: "PATCH",
      headers: { ...cookie(adminSession.token), "content-type": "application/json" },
      body: JSON.stringify({ state: "ARCHIVED" }),
    });
    expect(archived.status).toBe(200);
    expect(stopped).toEqual(["learner"]);

    const purged = await app.request(`/api/admin/users/${learner.id}?purge=1`, {
      method: "DELETE",
      headers: cookie(adminSession.token),
    });
    expect(purged.status).toBe(204);
    expect(stopped).toEqual(["learner", "learner"]);
    await expect(fs.access(root)).rejects.toThrow();
    const trashDir = path.join(tempDir, "trash");
    const entries = await fs.readdir(trashDir);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatch(/^learner-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}\.\d{3}Z$/);
  });

  it("gates AI routes but permits creating a chat", async () => {
    const user = await createUser(db, { username: "learner", role: "USER", aiEnabled: false });
    const session = createSession(db, user.id, { userAgent: "", ip: "" });
    const app = server();
    const headers = { ...cookie(session.token), "content-type": "application/json" };
    for (const target of [
      "/api/jobs",
      "/api/library",
      "/api/sets/sample/chats/chat-1/messages",
      "/api/sets/sample/chats/chat-1/abort",
    ]) {
      const response = await app.request(target, { method: "POST", headers, body: "{}" });
      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toEqual({ error: "AI features are disabled for this account" });
    }
    const allowed = await app.request("/api/sets/sample/chats", { method: "POST", headers, body: "{}" });
    expect(allowed.status).toBe(202);
    await expect(allowed.json()).resolves.toEqual({ ok: true });
  });

  it("lets an AI-enabled user reach AI routes", async () => {
    const user = await createUser(db, { username: "learner", role: "USER" });
    const session = createSession(db, user.id, { userAgent: "", ip: "" });
    const headers = { ...cookie(session.token), "content-type": "application/json" };
    const response = await server().request("/api/jobs", { method: "POST", headers, body: "{}" });
    expect(response.status).not.toBe(403);
  });

  it("changes a password and revokes every other session", async () => {
    const user = await createUser(db, { username: "learner", password: "old-password", role: "USER" });
    const current = createSession(db, user.id, { userAgent: "current", ip: "" });
    createSession(db, user.id, { userAgent: "other", ip: "" });
    const response = await server().request("/api/me/password", {
      method: "POST",
      headers: { ...cookie(current.token), "content-type": "application/json" },
      body: JSON.stringify({ currentPassword: "old-password", newPassword: "new-password" }),
    });
    expect(response.status).toBe(204);
    expect(listSessions(db, user.id).map((session) => session.id)).toEqual([current.id]);
    expect(await verifyUserPassword(db, user.id, "new-password")).toBe(true);
  });

  it("mounts notifications and export behind the session, ahead of the workspace delegate", async () => {
    const user = await createUser(db, { username: "learner", role: "USER" });
    const session = createSession(db, user.id, { userAgent: "", ip: "" });
    const root = path.join(tempDir, "users", "learner");
    roots.learner = root;
    await fs.mkdir(path.join(root, "_global"), { recursive: true });
    await fs.writeFile(path.join(root, "PLAN.md"), "# Plan\n");
    const app = server();

    expect((await app.request("/api/me/notifications")).status).toBe(401);
    expect((await app.request("/api/me/export")).status).toBe(401);

    const notifications = await app.request("/api/me/notifications", { headers: cookie(session.token) });
    expect(notifications.status).toBe(200);
    const body = (await notifications.json()) as { vapidPublicKey: string; ntfy: { url: string } };
    expect(typeof body.vapidPublicKey).toBe("string");
    expect(body.ntfy.url).toBe("");

    const exported = await app.request("/api/me/export", { headers: cookie(session.token) });
    expect(exported.status).toBe(200);
    expect(exported.headers.get("content-type")).toBe("application/zip");
  });

  it("serves static assets and the SPA fallback outside /api", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-web-"));
    tempDirs.push(dir);
    await fs.writeFile(path.join(dir, "index.html"), "<!doctype html><title>Studium</title>");
    await fs.writeFile(path.join(dir, "asset.txt"), "asset");
    const app = server(dir);
    expect(await (await app.request("/asset.txt")).text()).toBe("asset");
    expect(await (await app.request("/settings")).text()).toContain("Studium");
    expect((await app.request("/api/nope")).status).toBe(401);
  });
});
