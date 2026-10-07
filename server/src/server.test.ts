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
  it("serves health without authentication before setup and after setup", async () => {
    const app = server();
    const response = await app.request("/api/healthz");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, version: "dev" });
    expect((await app.request("/api/me")).status).toBe(401);
    await createUser(db, { username: "admin", role: "ADMIN" });
    expect((await app.request("/api/healthz")).status).toBe(200);
    expect(provisioned).toEqual([]);
  });

  it("reports the supplied release version in health", async () => {
    const app = createServer({
      db,
      instanceSecret: Buffer.alloc(32, 1),
      workspaces: {
        for: async () => ({ app: workspace }),
        provision: async () => undefined,
        stop: async () => undefined,
        rootFor: () => null,
      },
      authOpts: { trustProxy: false, baseUrl: null, setupCode: null },
      version: "v0.1.0",
    });
    await expect((await app.request("/api/healthz")).json()).resolves.toEqual({ ok: true, version: "v0.1.0" });
  });

  it("restricts the YouTube admin routes to admins", async () => {
    const member = await createUser(db, { username: "member", password: "member-pass", role: "USER" });
    const admin = await createUser(db, { username: "owner", password: "owner-pass", role: "ADMIN" });
    const memberSession = createSession(db, member.id, { userAgent: "", ip: "" });
    const adminSession = createSession(db, admin.id, { userAgent: "", ip: "" });
    const status = {
      engine: {
        state: "missing" as const,
        source: null,
        version: null,
        asset: "yt-dlp_linux",
        platformSupported: true,
        platformLabel: "linux x86_64",
        nodePresent: true,
        managedInstalled: false,
        managedVersion: null,
        managedShadowed: false,
        envOverrideInvalid: false,
      },
      cookies: {
        source: "none" as const,
        configured: false,
        readable: false,
        stale: false,
        lastSuccessAt: null,
        lastSuccessVideoId: null,
      },
      mode: "basic" as const,
      modeLabel: "Transcripts: basic",
      updateRecommended: false,
    };
    const app = createServer({
      db,
      instanceSecret: Buffer.alloc(32, 1),
      workspaces: {
        for: async () => ({ app: workspace }),
        provision: async () => undefined,
        stop: async () => undefined,
        rootFor: () => null,
      },
      authOpts: { trustProxy: false, baseUrl: null, setupCode: null },
      youtube: {
        status: async () => status,
        install: async () => status,
        update: async () => status,
        uploadCookies: async () => status,
        removeCookies: async () => status,
      },
    });

    expect((await app.request("/api/admin/youtube/status")).status).toBe(401);
    expect((await app.request("/api/admin/youtube/status", { headers: cookie(memberSession.token) })).status).toBe(403);
    expect(
      (await app.request("/api/admin/youtube/install", { method: "POST", headers: cookie(memberSession.token) }))
        .status,
    ).toBe(403);
    expect((await app.request("/api/admin/youtube/status", { headers: cookie(adminSession.token) })).status).toBe(200);
  });

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

  it("rejects duplicate emails in self-service and admin create or patch", async () => {
    const admin = await createUser(db, { username: "admin", role: "ADMIN", email: "owner@example.com" });
    const learner = await createUser(db, { username: "learner", role: "USER" });
    const adminSession = createSession(db, admin.id, { userAgent: "", ip: "" });
    const learnerSession = createSession(db, learner.id, { userAgent: "", ip: "" });
    const app = server();
    const headers = { ...cookie(adminSession.token), "content-type": "application/json" };

    const created = await app.request("/api/admin/users", {
      method: "POST",
      headers,
      body: JSON.stringify({ username: "duplicate", role: "USER", email: "OWNER@example.com" }),
    });
    expect(created.status).toBe(409);

    const patched = await app.request(`/api/admin/users/${learner.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ email: "Owner@example.com" }),
    });
    expect(patched.status).toBe(409);

    const selfPatched = await app.request("/api/me", {
      method: "PATCH",
      headers: { ...cookie(learnerSession.token), "content-type": "application/json" },
      body: JSON.stringify({ email: "owner@example.com" }),
    });
    expect(selfPatched.status).toBe(409);
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
      "/api/library/site-import",
      "/api/library/site-import/",
      "/api/sets/sample/practice/teachback",
      "/api/sets/sample/practice/teachback/",
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
    const map = await app.request("/api/library/site-map", { method: "POST", headers, body: "{}" });
    expect(map.status).toBe(202);
  });

  it("lets an AI-enabled user reach AI routes", async () => {
    const user = await createUser(db, { username: "learner", role: "USER" });
    const session = createSession(db, user.id, { userAgent: "", ip: "" });
    const headers = { ...cookie(session.token), "content-type": "application/json" };
    const response = await server().request("/api/jobs", { method: "POST", headers, body: "{}" });
    expect(response.status).not.toBe(403);
  });

  it("lets AI-disabled users compile books while blocking AI jobs and disguised proposals", async () => {
    const user = await createUser(db, { username: "learner", role: "USER", aiEnabled: false });
    const session = createSession(db, user.id, { userAgent: "", ip: "" });
    const app = server();
    const headers = { ...cookie(session.token), "content-type": "application/json" };
    const bodies = [
      { kind: "compile-book", set: "sample" },
      { kind: "draft-chapter", set: "sample", title: "AI chapter" },
      { kind: "compile-book", set: "sample", proposalId: "ai-proposal" },
    ];
    workspace = new Hono();
    workspace.post("/api/jobs/", async (c) => c.json(await c.req.json(), 202));
    const allowed = await app.request("/api/jobs/", { method: "POST", headers, body: JSON.stringify(bodies[0]) });
    expect(allowed.status).toBe(202);
    await expect(allowed.json()).resolves.toEqual(bodies[0]);
    for (const body of bodies.slice(1)) {
      expect((await app.request("/api/jobs", { method: "POST", headers, body: JSON.stringify(body) })).status).toBe(
        403,
      );
    }
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

it("passes a trusted account AI binding to the workspace practice gate", async () => {
  const user = await createUser(db, { username: "learner", role: "USER", aiEnabled: false });
  const session = createSession(db, user.id, { userAgent: "", ip: "" });
  workspace = new Hono();
  workspace.post("/api/sets/sample/practice/quizzes/quiz-12345678/answer", (c) =>
    c.json(
      {
        aiEnabled: (c.env as { practiceAiEnabled: boolean }).practiceAiEnabled,
        existing: (c.env as { existing: string }).existing,
      },
      202,
    ),
  );
  const response = await server().request(
    "/api/sets/sample/practice/quizzes/quiz-12345678/answer",
    {
      method: "POST",
      headers: { ...cookie(session.token), "content-type": "application/json", "practice-ai-enabled": "true" },
      body: "{}",
    },
    { existing: "preserved", practiceAiEnabled: true },
  );
  expect(response.status).toBe(202);
  expect(await response.json()).toEqual({ aiEnabled: false, existing: "preserved" });
});

it("gates default and positive plan drafts using the real approval route, while allowing zero", async () => {
  const { EventHub } = await import("./events.js");
  const { JobRunner } = await import("./jobs/runner.js");
  const { FileLocks } = await import("./tree/lock.js");
  const { ensureRepo } = await import("./tree/git.js");
  const { inboxRoutes } = await import("./routes/inbox.js");
  const { PROPOSED_PLAN, proposalText, proposedCurriculum } = await import("./inbox/plan.test-helper.js");
  const root = path.join(tempDir, "study");
  await fs.mkdir(path.join(root, "sample/plan-proposals"), { recursive: true });
  await fs.mkdir(path.join(root, "library/lib-strang-la"), { recursive: true });
  await fs.writeFile(path.join(root, "library/lib-strang-la/source.md"), "# Source");
  await fs.writeFile(path.join(root, "sample/PLAN.md"), "# Old plan");
  await fs.writeFile(path.join(root, "sample/plan-proposals/plan.md"), proposalText());
  await ensureRepo(root);
  const user = await createUser(db, { username: "learner", role: "USER", aiEnabled: false });
  const session = createSession(db, user.id, { userAgent: "", ip: "" });
  const hub = new EventHub();
  const jobs = new JobRunner({ root, hub, maxParallel: 1, aiAllowed: () => false });
  workspace = new Hono();
  workspace.route("/api/sets/:set", inboxRoutes({ root, hub, locks: new FileLocks(), jobs }));
  const app = server();
  for (const [body, suffix] of [
    [undefined, ""],
    [{}, "/"],
    [{ draftFirst: 2, addSources: false }, ""],
    [{ draftFirst: 0 }, ""],
  ] as const) {
    const response = await app.request(`/api/sets/sample/plan-proposals/plan.md/approve${suffix}`, {
      method: "POST",
      headers: { ...cookie(session.token), "content-type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "AI features are disabled for this account" });
    expect(await fs.readFile(path.join(root, "sample/PLAN.md"), "utf8")).toBe("# Old plan");
    expect(await fs.readFile(path.join(root, "sample/plan-proposals/plan.md"), "utf8")).toBe(proposalText());
  }
  const response = await app.request("/api/sets/sample/plan-proposals/plan.md/approve", {
    method: "POST",
    headers: { ...cookie(session.token), "content-type": "application/json" },
    body: '{"draftFirst":0,"addSources":false}',
  });
  expect(response.status).toBe(200);
  expect(await fs.readFile(path.join(root, "sample/PLAN.md"), "utf8")).toBe(PROPOSED_PLAN);
  expect(await fs.readFile(path.join(root, "sample/curriculum.md"), "utf8")).toBe(proposedCurriculum());
  expect(jobs.list()).toEqual([]);
});
