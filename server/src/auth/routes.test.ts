import { Hono } from "hono";
import { beforeAll, describe, expect, it } from "vitest";
import { hashPassword } from "./password.js";
import { authRoutes, requireAuth } from "./routes.js";
import type { AuthConfig } from "./session.js";

const sessionSecret = "a-secure-session-secret-at-least-32-chars";
let protectedConfig: AuthConfig;

beforeAll(async () => {
  protectedConfig = {
    username: "learner",
    passwordHash: await hashPassword("study-password"),
    sessionSecret,
    apiToken: "api-token",
  };
});

function makeAuthApp(cfg: AuthConfig): Hono {
  const app = new Hono();
  app.route("/api/auth", authRoutes(cfg));
  return app;
}

function login(app: Hono, username: string, password: string, ip = "192.0.2.1", url = "/api/auth/login") {
  return app.request(url, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-for": ip },
    body: JSON.stringify({ username, password }),
  });
}

describe("auth routes", () => {
  it("logs in, sets the required cookie, and authenticates /me", async () => {
    const app = makeAuthApp(protectedConfig);
    const response = await login(app, "learner", "study-password");

    expect(response.status).toBe(204);
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("studium_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("Max-Age=2592000");
    expect(setCookie).toContain("Path=/");
    expect(setCookie).toContain("SameSite=Strict");
    expect(setCookie).not.toContain("Secure");

    const cookie = setCookie.split(";", 1)[0];
    const me = await app.request("/api/auth/me", { headers: { cookie } });
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toEqual({ username: "learner" });
  });

  it("marks cookies Secure for HTTPS requests", async () => {
    const app = makeAuthApp(protectedConfig);
    const response = await login(app, "learner", "study-password", "192.0.2.2", "https://example.test/api/auth/login");

    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("returns the same error for a wrong username or password", async () => {
    const app = makeAuthApp(protectedConfig);
    const wrongUsername = await login(app, "someone-else", "study-password", "192.0.2.3");
    const wrongPassword = await login(app, "learner", "wrong-password", "192.0.2.4");

    expect(wrongUsername.status).toBe(401);
    expect(wrongPassword.status).toBe(401);
    await expect(wrongUsername.json()).resolves.toEqual({ error: "invalid credentials" });
    await expect(wrongPassword.json()).resolves.toEqual({ error: "invalid credentials" });
  });

  it("rate limits the sixth failed login from an IP", async () => {
    const app = makeAuthApp(protectedConfig);
    const statuses: number[] = [];

    for (let count = 0; count < 6; count += 1) {
      statuses.push((await login(app, "learner", "wrong-password", "192.0.2.5")).status);
    }

    expect(statuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it("resets failed attempts after a successful login", async () => {
    const app = makeAuthApp(protectedConfig);
    for (let count = 0; count < 4; count += 1) {
      await login(app, "learner", "wrong-password", "192.0.2.6");
    }

    expect((await login(app, "learner", "study-password", "192.0.2.6")).status).toBe(204);
    expect((await login(app, "learner", "wrong-password", "192.0.2.6")).status).toBe(401);
  });

  it("rejects /me without credentials and accepts a bearer token", async () => {
    const app = makeAuthApp(protectedConfig);
    const unauthorized = await app.request("/api/auth/me");
    const authorized = await app.request("/api/auth/me", {
      headers: { authorization: "Bearer api-token" },
    });

    expect(unauthorized.status).toBe(401);
    await expect(unauthorized.json()).resolves.toEqual({ error: "unauthorized" });
    expect(authorized.status).toBe(200);
    await expect(authorized.json()).resolves.toEqual({ username: "learner" });
  });

  it("clears the cookie on logout", async () => {
    const app = makeAuthApp(protectedConfig);
    const loginResponse = await login(app, "learner", "study-password", "192.0.2.7");
    const cookie = (loginResponse.headers.get("set-cookie") ?? "").split(";", 1)[0];
    const response = await app.request("/api/auth/logout", { method: "POST", headers: { cookie } });

    expect(response.status).toBe(204);
    expect(response.headers.get("set-cookie")).toContain("studium_session=; Max-Age=0");
  });

  it("allows auth routes and middleware as local when no password is configured", async () => {
    const passwordless = { username: null, passwordHash: null, sessionSecret: null, apiToken: null };
    const app = makeAuthApp(passwordless);
    app.get("/api/protected", requireAuth(passwordless), (c) => c.json({ username: c.get("username") }));

    expect((await app.request("/api/auth/login", { method: "POST" })).status).toBe(204);
    const me = await app.request("/api/auth/me");
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toEqual({ username: "local" });
    await expect((await app.request("/api/protected")).json()).resolves.toEqual({ username: "local" });
  });
});
