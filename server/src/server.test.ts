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
const tempDirs: string[] = [];

beforeEach(async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-server-"));
  tempDirs.push(dir);
  db = openDb(path.join(dir, "studium.db"));
  migrate(db);
  workspace = new Hono();
  workspace.get("/api/sets", (c) => c.json([{ slug: "sample" }]));
});

afterEach(async () => {
  db.close();
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function server(webDist?: string): Hono {
  return createServer({
    db,
    workspaces: { for: () => ({ app: workspace }) },
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
