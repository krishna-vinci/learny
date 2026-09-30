import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { serveStatic } from "@hono/node-server/serve-static";
import { type Context, Hono } from "hono";
import { listSessions, revokeAllSessions, revokeSession } from "./accounts/sessions.js";
import { getInstanceSettings, updateInstanceSettings } from "./accounts/settings.js";
import { createAccessToken, deleteAccessToken, listAccessTokens } from "./accounts/tokens.js";
import {
  countAdmins,
  createUser,
  deleteUser,
  emailBelongsToAnotherUser,
  getUserById,
  listUsers,
  type User,
  type UserPatch,
  updateUser,
  verifyUserPassword,
} from "./accounts/users.js";
import { requireAdmin, sessionAuth } from "./auth/middleware.js";
import { hashPassword } from "./auth/password.js";
import { type AuthRouteOptions, authRoutes } from "./auth/routes.js";
import { type BackupRouteDeps, backupRoutes } from "./backups/routes.js";
import { deriveKey } from "./db/secret.js";
import { exportRoutes } from "./export/routes.js";
import { requestGuard } from "./http/guard.js";
import { Notifier } from "./notify/notifier.js";
import { notificationRoutes } from "./notify/routes.js";
import { identityProviderAdminRoutes, identityRoutes, ssoAuthRoutes } from "./sso/routes.js";

export interface WorkspaceProvider {
  for(user: User): Promise<{ app: Hono }>;
  provision(username: string, templateFromRoot?: string): Promise<unknown>;
  stop(username: string): Promise<void>;
  rootFor(username: string): string | null;
}

export interface ServerDeps {
  db: DatabaseSync;
  instanceSecret: Buffer;
  workspaces: WorkspaceProvider;
  webDist?: string;
  authOpts: Omit<AuthRouteOptions, "db">;
  backups?: BackupRouteDeps;
  notifier?: Notifier;
}

async function jsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parseId(value: string): number | null {
  if (!/^\d+$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

function validInstanceUrl(value: string): boolean {
  if (value === "") return true;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

function aiRouteDisabled(method: string, pathname: string): boolean {
  if (method !== "POST") return false;
  const path = pathname.endsWith("/") && pathname.length > 1 ? pathname.slice(0, -1) : pathname;
  if (path === "/api/jobs" || path === "/api/library" || path === "/api/library/site-import") return true;
  const chatMatch = /^\/api\/sets\/[^/]+\/chats(\/.*)?$/.exec(path);
  return chatMatch !== null && chatMatch[1] !== undefined;
}

function meRoutes(db: DatabaseSync): Hono {
  const app = new Hono();

  app.get("/", (c) => c.json({ user: c.get("user") }));

  app.patch("/", async (c) => {
    const body = await jsonBody(c);
    if (body === null) return c.json({ error: "invalid JSON body" }, 400);
    const patch: UserPatch = {};
    for (const [bodyKey, patchKey] of [
      ["displayName", "displayName"],
      ["email", "email"],
      ["avatarUrl", "avatarUrl"],
    ] as const) {
      const value = body[bodyKey];
      if (value !== undefined && typeof value !== "string")
        return c.json({ error: `${bodyKey} must be a string` }, 400);
      if (typeof value === "string") patch[patchKey] = value;
    }
    if (patch.email !== undefined && emailBelongsToAnotherUser(db, patch.email, c.get("user").id)) {
      return c.json({ error: "email is already in use" }, 409);
    }
    return c.json({ user: updateUser(db, c.get("user").id, patch) });
  });

  app.post("/password", async (c) => {
    const body = await jsonBody(c);
    const newPassword = typeof body?.newPassword === "string" ? body.newPassword : "";
    if (newPassword.length < 8) return c.json({ error: "newPassword must be at least 8 characters" }, 400);
    const user = c.get("user");
    if (user.hasPassword) {
      const currentPassword = typeof body?.currentPassword === "string" ? body.currentPassword : "";
      if (!(await verifyUserPassword(db, user.id, currentPassword))) {
        return c.json({ error: "current password is incorrect" }, 403);
      }
    }
    updateUser(db, user.id, { passwordHash: await hashPassword(newPassword) });
    revokeAllSessions(db, user.id, c.get("sessionId") ?? undefined);
    return c.body(null, 204);
  });

  app.get("/sessions", (c) => {
    const currentId = c.get("sessionId");
    return c.json({
      sessions: listSessions(db, c.get("user").id).map((session) => ({
        ...session,
        current: session.id === currentId,
      })),
    });
  });

  app.delete("/sessions/:id", (c) => {
    revokeSession(db, c.get("user").id, c.req.param("id"));
    return c.body(null, 204);
  });

  app.get("/access-tokens", (c) => c.json({ accessTokens: listAccessTokens(db, c.get("user").id) }));

  app.post("/access-tokens", async (c) => {
    const body = await jsonBody(c);
    if (body === null || typeof body.description !== "string") {
      return c.json({ error: "description must be a string" }, 400);
    }
    const expiresInDays = body.expiresInDays;
    if (expiresInDays !== undefined && (!Number.isInteger(expiresInDays) || (expiresInDays as number) <= 0)) {
      return c.json({ error: "expiresInDays must be a positive integer" }, 400);
    }
    const created = createAccessToken(db, c.get("user").id, {
      description: body.description,
      ...(typeof expiresInDays === "number" ? { expiresInDays } : {}),
    });
    return c.json(created, 201);
  });

  app.delete("/access-tokens/:id", (c) => {
    deleteAccessToken(db, c.get("user").id, c.req.param("id"));
    return c.body(null, 204);
  });

  return app;
}

function adminRoutes(db: DatabaseSync, workspaces: WorkspaceProvider): Hono {
  const app = new Hono();

  app.get("/users", (c) => c.json({ users: listUsers(db) }));

  app.post("/users", async (c) => {
    const body = await jsonBody(c);
    if (body === null || typeof body.username !== "string" || (body.role !== "ADMIN" && body.role !== "USER")) {
      return c.json({ error: "username and a valid role are required" }, 400);
    }
    if (body.password !== undefined && typeof body.password !== "string")
      return c.json({ error: "password must be a string" }, 400);
    if (body.displayName !== undefined && typeof body.displayName !== "string")
      return c.json({ error: "displayName must be a string" }, 400);
    if (body.email !== undefined && typeof body.email !== "string")
      return c.json({ error: "email must be a string" }, 400);
    if (body.aiEnabled !== undefined && typeof body.aiEnabled !== "boolean")
      return c.json({ error: "aiEnabled must be boolean" }, 400);
    if (typeof body.email === "string" && emailBelongsToAnotherUser(db, body.email)) {
      return c.json({ error: "email is already in use" }, 409);
    }
    try {
      const user = await createUser(db, {
        username: body.username,
        role: body.role,
        ...(typeof body.password === "string" ? { password: body.password } : {}),
        ...(typeof body.displayName === "string" ? { displayName: body.displayName } : {}),
        ...(typeof body.email === "string" ? { email: body.email } : {}),
        ...(typeof body.aiEnabled === "boolean" ? { aiEnabled: body.aiEnabled } : {}),
      });
      try {
        await workspaces.provision(user.username);
      } catch (error) {
        deleteUser(db, user.id);
        throw error;
      }
      return c.json({ user }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "could not create user" }, 400);
    }
  });

  app.patch("/users/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const target = id === null ? null : getUserById(db, id);
    if (target === null) return c.json({ error: "not found" }, 404);
    const body = await jsonBody(c);
    if (body === null) return c.json({ error: "invalid JSON body" }, 400);
    if (body.role !== undefined && body.role !== "ADMIN" && body.role !== "USER")
      return c.json({ error: "invalid role" }, 400);
    if (body.state !== undefined && body.state !== "NORMAL" && body.state !== "ARCHIVED")
      return c.json({ error: "invalid state" }, 400);
    if (body.aiEnabled !== undefined && typeof body.aiEnabled !== "boolean")
      return c.json({ error: "aiEnabled must be boolean" }, 400);
    for (const field of ["displayName", "email", "password"] as const) {
      if (body[field] !== undefined && typeof body[field] !== "string")
        return c.json({ error: `${field} must be a string` }, 400);
    }
    if (typeof body.password === "string" && body.password.length < 8)
      return c.json({ error: "password must be at least 8 characters" }, 400);
    if (typeof body.email === "string" && emailBelongsToAnotherUser(db, body.email, target.id)) {
      return c.json({ error: "email is already in use" }, 409);
    }
    const removesActiveAdmin =
      target.role === "ADMIN" && target.state === "NORMAL" && (body.role === "USER" || body.state === "ARCHIVED");
    if (removesActiveAdmin && countAdmins(db) === 1) return c.json({ error: "cannot remove the last admin" }, 409);

    const patch: UserPatch = {};
    if (body.role === "ADMIN" || body.role === "USER") patch.role = body.role;
    if (body.state === "NORMAL" || body.state === "ARCHIVED") patch.state = body.state;
    if (typeof body.aiEnabled === "boolean") patch.aiEnabled = body.aiEnabled;
    if (typeof body.displayName === "string") patch.displayName = body.displayName;
    if (typeof body.email === "string") patch.email = body.email;
    if (typeof body.password === "string") patch.passwordHash = await hashPassword(body.password);
    const user = updateUser(db, target.id, patch);
    if (patch.passwordHash !== undefined || patch.state === "ARCHIVED") revokeAllSessions(db, target.id);
    if (body.aiEnabled !== undefined || patch.state === "ARCHIVED") await workspaces.stop(target.username);
    return c.json({ user });
  });

  app.delete("/users/:id", async (c) => {
    const id = parseId(c.req.param("id"));
    const target = id === null ? null : getUserById(db, id);
    if (target === null) return c.json({ error: "not found" }, 404);
    if (target.id === c.get("user").id) return c.json({ error: "cannot delete your own account" }, 409);
    if (target.role === "ADMIN" && target.state === "NORMAL" && countAdmins(db) === 1) {
      return c.json({ error: "cannot remove the last admin" }, 409);
    }
    revokeAllSessions(db, target.id);
    await workspaces.stop(target.username);
    if (c.req.query("purge") === "1") {
      const root = workspaces.rootFor(target.username);
      if (root !== null) {
        const trash = path.join(path.dirname(path.dirname(root)), "trash");
        await fs.mkdir(trash, { recursive: true });
        await fs.rename(root, path.join(trash, `${target.username}-${new Date().toISOString().replaceAll(":", "-")}`));
      }
      deleteUser(db, target.id);
    } else {
      updateUser(db, target.id, { state: "ARCHIVED" });
    }
    return c.body(null, 204);
  });

  app.get("/instance", (c) => c.json(getInstanceSettings(db)));
  app.patch("/instance", async (c) => {
    const body = await jsonBody(c);
    if (body === null) return c.json({ error: "invalid JSON body" }, 400);
    if (body.disallowPasswordAuth !== undefined && typeof body.disallowPasswordAuth !== "boolean") {
      return c.json({ error: "disallowPasswordAuth must be boolean" }, 400);
    }
    if (
      body.instanceUrl !== undefined &&
      (typeof body.instanceUrl !== "string" || !validInstanceUrl(body.instanceUrl))
    ) {
      return c.json({ error: "instanceUrl must be an http(s) URL or empty" }, 400);
    }
    return c.json(
      updateInstanceSettings(db, {
        ...(typeof body.disallowPasswordAuth === "boolean" ? { disallowPasswordAuth: body.disallowPasswordAuth } : {}),
        ...(typeof body.instanceUrl === "string" ? { instanceUrl: body.instanceUrl } : {}),
      }),
    );
  });

  return app;
}

export function createServer(deps: ServerDeps): Hono {
  const app = new Hono();
  const secretsKey = deriveKey(deps.instanceSecret, "studium-secrets-v1");
  const notifier = deps.notifier ?? new Notifier({ db: deps.db, secretsKey });
  const ssoOptions = {
    db: deps.db,
    secretsKey,
    auth: { db: deps.db, ...deps.authOpts },
  };
  app.use("/api/*", requestGuard());
  app.route("/api/auth", authRoutes({ db: deps.db, ...deps.authOpts }));
  app.route("/api/auth", ssoAuthRoutes(ssoOptions));
  app.use("/api/*", sessionAuth(deps.db));
  app.route("/api/me/identities", identityRoutes(ssoOptions));
  app.route("/api/me/notifications", notificationRoutes({ db: deps.db, secretsKey, notifier }));
  app.route("/api/me/export", exportRoutes({ rootFor: (username) => deps.workspaces.rootFor(username) }));
  app.route("/api/me", meRoutes(deps.db));
  app.use("/api/admin/*", requireAdmin);
  app.route("/api/admin/identity-providers", identityProviderAdminRoutes(ssoOptions));
  app.route("/api/admin", adminRoutes(deps.db, deps.workspaces));
  if (deps.backups !== undefined) app.route("/api/admin/backups", backupRoutes(deps.backups));
  app.use("/api/*", async (c, next) => {
    if (!c.get("user").aiEnabled && aiRouteDisabled(c.req.method, c.req.path)) {
      return c.json({ error: "AI features are disabled for this account" }, 403);
    }
    await next();
  });
  app.all("/api/*", async (c) => (await deps.workspaces.for(c.get("user"))).app.fetch(c.req.raw, c.env));

  if (deps.webDist !== undefined && existsSync(deps.webDist)) {
    const webRoot = deps.webDist;
    app.use("*", async (c, next) => {
      if (c.req.method !== "GET" || c.req.path.startsWith("/api/")) return next();
      return serveStatic({ root: webRoot })(c, next);
    });
    app.get("*", async (c, next) => {
      if (c.req.path.startsWith("/api/")) return next();
      return serveStatic({ root: webRoot, rewriteRequestPath: () => "/index.html" })(c, next);
    });
  }
  return app;
}
