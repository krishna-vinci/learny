import { Hono } from "hono";
import { beforeAll, describe, expect, it, vi } from "vitest";
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
    trustProxy: false,
    baseUrl: null,
  };
});

function makeAuthApp(cfg: AuthConfig): Hono {
  const app = new Hono();
  app.route("/api/auth", authRoutes(cfg));
  return app;
}

function login(
  app: Hono,
  username: string,
  password: string,
  forwardedFor = "192.0.2.1",
  url = "/api/auth/login",
  remoteAddress = "198.51.100.1",
) {
  return app.request(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": forwardedFor },
      body: JSON.stringify({ username, password }),
    },
    { incoming: { socket: { remoteAddress } } },
  );
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

  it("only trusts forwarded HTTPS with proxy trust, while an HTTPS base URL always marks cookies Secure", async () => {
    const forwardedOnly = await makeAuthApp(protectedConfig).request(
      "/api/auth/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "192.0.2.20",
          "x-forwarded-proto": "https",
        },
        body: JSON.stringify({ username: "learner", password: "study-password" }),
      },
      { incoming: { socket: { remoteAddress: "198.51.100.20" } } },
    );
    expect(forwardedOnly.headers.get("set-cookie")).not.toContain("Secure");

    const proxyApp = makeAuthApp({ ...protectedConfig, trustProxy: true });
    const proxyResponse = await proxyApp.request(
      "/api/auth/login",
      {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-forwarded-for": "192.0.2.21",
          "x-forwarded-proto": "https",
        },
        body: JSON.stringify({ username: "learner", password: "study-password" }),
      },
      { incoming: { socket: { remoteAddress: "198.51.100.21" } } },
    );
    expect(proxyResponse.headers.get("set-cookie")).toContain("Secure");

    const baseUrlResponse = await login(
      makeAuthApp({ ...protectedConfig, baseUrl: "https://studium.example" }),
      "learner",
      "study-password",
      "192.0.2.22",
    );
    expect(baseUrlResponse.headers.get("set-cookie")).toContain("Secure");
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

  it("ignores spoofed forwarded IPs by default and uses the last entry when proxy trust is enabled", async () => {
    const directApp = makeAuthApp(protectedConfig);
    const directStatuses: number[] = [];
    for (let count = 0; count < 6; count += 1) {
      directStatuses.push(
        (await login(directApp, "learner", "wrong-password", `192.0.2.${count}`, "/api/auth/login", "203.0.113.5"))
          .status,
      );
    }
    expect(directStatuses).toEqual([401, 401, 401, 401, 401, 429]);

    const proxyApp = makeAuthApp({ ...protectedConfig, trustProxy: true });
    const proxyStatuses: number[] = [];
    for (let count = 0; count < 6; count += 1) {
      proxyStatuses.push(
        (
          await login(
            proxyApp,
            "learner",
            "wrong-password",
            `192.0.2.${count}, 203.0.113.6`,
            "/api/auth/login",
            `198.51.100.${count}`,
          )
        ).status,
      );
    }
    expect(proxyStatuses).toEqual([401, 401, 401, 401, 401, 429]);
  });

  it("prunes expired buckets on an attempt from another IP", async () => {
    vi.useFakeTimers();
    try {
      const start = new Date("2026-01-01T00:00:00Z");
      vi.setSystemTime(start);
      const app = makeAuthApp({ ...protectedConfig, passwordHash: "invalid" });
      for (let count = 0; count < 5; count += 1) {
        expect((await login(app, "learner", "wrong-password", "", "/api/auth/login", "203.0.113.7")).status).toBe(401);
      }

      vi.setSystemTime(new Date(start.getTime() + 15 * 60 * 1_000));
      expect((await login(app, "learner", "wrong-password", "", "/api/auth/login", "203.0.113.8")).status).toBe(401);

      vi.setSystemTime(new Date(start.getTime() + 1));
      expect((await login(app, "learner", "wrong-password", "", "/api/auth/login", "203.0.113.7")).status).toBe(401);
    } finally {
      vi.useRealTimers();
    }
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

  it("rejects a session after the password hash changes", async () => {
    const originalApp = makeAuthApp(protectedConfig);
    const loginResponse = await login(originalApp, "learner", "study-password", "192.0.2.8");
    const cookie = (loginResponse.headers.get("set-cookie") ?? "").split(";", 1)[0];

    const changedApp = makeAuthApp({ ...protectedConfig, passwordHash: await hashPassword("new-password") });
    expect((await changedApp.request("/api/auth/me", { headers: { cookie } })).status).toBe(401);
  });

  it("allows auth routes and middleware as local when no password is configured", async () => {
    const passwordless: AuthConfig = {
      username: null,
      passwordHash: null,
      sessionSecret: null,
      apiToken: null,
      trustProxy: false,
      baseUrl: null,
    };
    const app = makeAuthApp(passwordless);
    app.get("/api/protected", requireAuth(passwordless), (c) => c.json({ username: c.get("username") }));

    expect((await app.request("/api/auth/login", { method: "POST" })).status).toBe(204);
    const me = await app.request("/api/auth/me");
    expect(me.status).toBe(200);
    await expect(me.json()).resolves.toEqual({ username: "local" });
    await expect((await app.request("/api/protected")).json()).resolves.toEqual({ username: "local" });
  });
});
