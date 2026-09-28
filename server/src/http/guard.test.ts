import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import type { AuthConfig } from "../auth/session.js";
import { requestGuard } from "./guard.js";

const PASSWORDLESS: AuthConfig = {
  username: null,
  passwordHash: null,
  sessionSecret: null,
  apiToken: null,
  trustProxy: false,
  baseUrl: null,
};

const PROTECTED: AuthConfig = {
  ...PASSWORDLESS,
  passwordHash: "hash",
  sessionSecret: "a-secure-session-secret-at-least-32-chars",
};

function makeApp(cfg: AuthConfig): Hono {
  const app = new Hono();
  app.use("/api/*", requestGuard(cfg));
  app.get("/api/events", (c) => c.json({ ok: true }));
  app.post("/api/change", (c) => c.json({ ok: true }));
  return app;
}

describe("requestGuard", () => {
  it("allows loopback hosts and rejects other hosts in passwordless mode", async () => {
    const app = makeApp(PASSWORDLESS);

    const forbidden = await app.request("/api/events", { headers: { host: "evil.example" } });
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({ error: "forbidden host" });

    expect((await app.request("/api/events", { headers: { host: "127.0.0.1:3000" } })).status).toBe(200);
    expect((await app.request("/api/events", { headers: { host: "[::1]:3000" } })).status).toBe(200);
  });

  it("rejects cross-site mutation headers", async () => {
    const app = makeApp(PROTECTED);
    const crossOrigin = await app.request("/api/change", {
      method: "POST",
      headers: { host: "studium.example", origin: "https://evil.example" },
    });
    const crossSite = await app.request("/api/change", {
      method: "POST",
      headers: { host: "studium.example", "sec-fetch-site": "cross-site" },
    });

    expect(crossOrigin.status).toBe(403);
    await expect(crossOrigin.json()).resolves.toEqual({ error: "cross-site request" });
    expect(crossSite.status).toBe(403);
    await expect(crossSite.json()).resolves.toEqual({ error: "cross-site request" });
  });

  it("allows same-origin mutations and does not apply the Origin check to GET", async () => {
    const app = makeApp(PROTECTED);
    const sameOrigin = await app.request("/api/change", {
      method: "POST",
      headers: { host: "studium.example", origin: "https://studium.example", "sec-fetch-site": "same-origin" },
    });
    const getWithOtherOrigin = await app.request("/api/events", {
      headers: { host: "studium.example", origin: "https://evil.example" },
    });

    expect(sameOrigin.status).toBe(200);
    expect(getWithOtherOrigin.status).toBe(200);
  });
});
