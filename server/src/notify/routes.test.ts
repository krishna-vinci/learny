import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUser, type User } from "../accounts/users.js";
import { migrate, openDb } from "../db/db.js";
import { Notifier } from "./notifier.js";
import { notificationRoutes } from "./routes.js";

let db: DatabaseSync;
let user: User;
const secretsKey = randomBytes(32);

beforeEach(async () => {
  db = openDb(":memory:");
  migrate(db);
  user = await createUser(db, { username: "learner", role: "USER" });
});

function makeApp(notifier: Notifier): Hono {
  const app = new Hono();
  app.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  app.route("/api/me/notifications", notificationRoutes({ db, secretsKey, notifier }));
  return app;
}

function jsonRequest(app: Hono, path: string, method: string, body: unknown): Promise<Response> {
  return Promise.resolve(
    app.request(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  );
}

describe("notification routes", () => {
  it("returns defaults with a VAPID public key", async () => {
    const response = await makeApp(new Notifier({ db, secretsKey })).request("/api/me/notifications");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.ntfy).toEqual({ url: "", hasToken: false });
    expect(typeof body.vapidPublicKey).toBe("string");
    expect((body.vapidPublicKey as string).length).toBeGreaterThan(0);
    expect(body.subscriptions).toEqual([]);
    expect(body.events).toEqual({ jobDone: true, jobFailed: true });
  });

  it("stores the ntfy token encrypted and returns hasToken only", async () => {
    const app = makeApp(new Notifier({ db, secretsKey }));
    const saved = await jsonRequest(app, "/api/me/notifications/ntfy", "PUT", {
      url: "https://ntfy.sh/studium-learner",
      token: "tk_live_secret",
    });
    expect(saved.status).toBe(200);
    await expect(saved.json()).resolves.toEqual({
      ntfy: { url: "https://ntfy.sh/studium-learner", hasToken: true },
    });

    const stored = (
      db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = 'ntfy'").get(user.id) as {
        value: string;
      }
    ).value;
    expect(stored).not.toContain("tk_live_secret");
    expect(stored).toMatch(/tokenEnc":"v1:/);

    const view = (await (await app.request("/api/me/notifications")).json()) as {
      ntfy: { url: string; hasToken: boolean };
    };
    expect(view.ntfy).toEqual({ url: "https://ntfy.sh/studium-learner", hasToken: true });
    expect(JSON.stringify(view)).not.toContain("tk_live_secret");
  });

  it("registers and removes a push subscription", async () => {
    const app = makeApp(new Notifier({ db, secretsKey }));
    const created = await jsonRequest(app, "/api/me/notifications/push", "POST", {
      endpoint: "https://push.example/abc",
      keys: { p256dh: "p256dh", auth: "auth" },
    });
    expect(created.status).toBe(201);
    const { subscription } = (await created.json()) as { subscription: { id: string; userAgent: string } };
    expect(subscription.userAgent).toBe("");

    const listed = (await (await app.request("/api/me/notifications")).json()) as {
      subscriptions: Array<{ id: string }>;
    };
    expect(listed.subscriptions.map((item) => item.id)).toEqual([subscription.id]);
    expect(JSON.stringify(listed)).not.toContain("p256dh");

    const removed = await app.request(`/api/me/notifications/push/${subscription.id}`, { method: "DELETE" });
    expect(removed.status).toBe(204);
    const after = (await (await app.request("/api/me/notifications")).json()) as { subscriptions: unknown[] };
    expect(after.subscriptions).toEqual([]);
  });

  it("toggles events and sends a test notification to all channels", async () => {
    const notifyUser = vi.fn(async (_userId: number, _notification: unknown) => undefined);
    const notifier = { notifyUser, notifyAdmins: vi.fn() } as unknown as Notifier;
    const app = makeApp(notifier);

    const patched = await jsonRequest(app, "/api/me/notifications/events", "PATCH", { jobDone: false });
    expect(patched.status).toBe(200);
    await expect(patched.json()).resolves.toEqual({ events: { jobDone: false, jobFailed: true } });

    const tested = await app.request("/api/me/notifications/test", { method: "POST" });
    expect(tested.status).toBe(200);
    expect(notifyUser).toHaveBeenCalledTimes(1);
    expect(notifyUser.mock.calls[0]?.[0]).toBe(user.id);
  });
});
