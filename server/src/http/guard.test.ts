import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { requestGuard } from "./guard.js";

function makeApp(): Hono {
  const app = new Hono();
  app.use("/api/*", requestGuard());
  app.get("/api/events", (c) => c.json({ ok: true }));
  app.post("/api/change", (c) => c.json({ ok: true }));
  return app;
}

describe("requestGuard", () => {
  it("allows requests regardless of host", async () => {
    expect((await makeApp().request("/api/events", { headers: { host: "studium.example" } })).status).toBe(200);
  });

  it("rejects cross-site mutation headers", async () => {
    const app = makeApp();
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
    const app = makeApp();
    expect(
      (
        await app.request("/api/change", {
          method: "POST",
          headers: { host: "studium.example", origin: "https://studium.example", "sec-fetch-site": "same-origin" },
        })
      ).status,
    ).toBe(200);
    expect(
      (await app.request("/api/events", { headers: { host: "studium.example", origin: "https://evil.example" } }))
        .status,
    ).toBe(200);
  });
});
