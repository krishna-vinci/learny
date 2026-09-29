import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { updateInstanceSettings } from "../accounts/settings.js";
import { createUser } from "../accounts/users.js";
import { migrate, openDb } from "../db/db.js";
import { authRoutes } from "./routes.js";

let db: DatabaseSync;
let tempDir: string;

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-auth-routes-"));
  db = openDb(path.join(tempDir, "studium.db"));
  migrate(db);
});

afterEach(async () => {
  db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

function makeApp(setupCode: string | null = null, trustProxy = false): Hono {
  const app = new Hono();
  app.route("/api/auth", authRoutes({ db, trustProxy, baseUrl: null, setupCode }));
  return app;
}

function post(app: Hono, path: string, body: unknown, ip = "192.0.2.1") {
  return app.request(
    path,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
      body: JSON.stringify(body),
    },
    { incoming: { socket: { remoteAddress: ip } } },
  );
}

describe("auth routes", () => {
  it("enforces the setup code and allows setup only once", async () => {
    const app = makeApp("a1b2c3d4e5f6");
    expect((await post(app, "/api/auth/setup", { username: "admin", password: "password1" })).status).toBe(403);
    const setup = await post(app, "/api/auth/setup", {
      username: "admin",
      password: "password1",
      setupCode: "a1b2c3d4e5f6",
    });
    expect(setup.status).toBe(201);
    expect(setup.headers.get("set-cookie")).toContain("studium_session=");
    expect(
      (
        await post(app, "/api/auth/setup", {
          username: "second",
          password: "password2",
          setupCode: "a1b2c3d4e5f6",
        })
      ).status,
    ).toBe(409);
  });

  it("rate limits the sixth failed setup code from one IP", async () => {
    const app = makeApp("a1b2c3d4e5f6");
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      statuses.push(
        (
          await post(app, "/api/auth/setup", {
            username: "admin",
            password: "password1",
            setupCode: "wrong",
          })
        ).status,
      );
    }
    expect(statuses).toEqual([403, 403, 403, 403, 403, 429]);
  });

  it("signs in through the new and compatibility routes and returns the compatible me shape", async () => {
    await createUser(db, { username: "learner", password: "study-password", role: "USER" });
    const app = makeApp();
    const signin = await post(app, "/api/auth/signin", { username: "learner", password: "study-password" });
    expect(signin.status).toBe(200);
    const cookie = (signin.headers.get("set-cookie") ?? "").split(";", 1)[0] ?? "";
    const me = await app.request("/api/auth/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ username: "learner", user: { username: "learner", hasPassword: true } });
    expect(
      (await post(app, "/api/auth/login", { username: "learner", password: "study-password" }, "192.0.2.2")).status,
    ).toBe(200);
  });

  it("rate limits the sixth failed sign-in from one IP", async () => {
    await createUser(db, { username: "learner", password: "study-password", role: "USER" });
    const app = makeApp();
    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      statuses.push((await post(app, "/api/auth/signin", { username: "learner", password: "wrong" })).status);
    }
    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it("blocks password sign-in for users but retains admin break-glass access", async () => {
    await createUser(db, { username: "admin", password: "admin-pass", role: "ADMIN" });
    await createUser(db, { username: "learner", password: "study-pass", role: "USER" });
    updateInstanceSettings(db, { disallowPasswordAuth: true });
    const app = makeApp();
    const user = await post(app, "/api/auth/signin", { username: "learner", password: "study-pass" }, "192.0.2.3");
    const admin = await post(app, "/api/auth/signin", { username: "admin", password: "admin-pass" }, "192.0.2.4");
    expect(user.status).toBe(403);
    await expect(user.json()).resolves.toEqual({ error: "password sign-in is disabled" });
    expect(admin.status).toBe(200);
  });

  it("sets Secure based on the base URL", async () => {
    await createUser(db, { username: "admin", password: "admin-pass", role: "ADMIN" });
    const app = new Hono();
    app.route("/api/auth", authRoutes({ db, trustProxy: false, baseUrl: "https://studium.example", setupCode: null }));
    const response = await post(app, "/api/auth/signin", { username: "admin", password: "admin-pass" });
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });
});
