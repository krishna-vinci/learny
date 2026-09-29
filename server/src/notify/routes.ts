import type { DatabaseSync } from "node:sqlite";
import { type Context, Hono } from "hono";
import { encryptSecret } from "../db/crypto.js";
import {
  type Notifier,
  readNotificationEvents,
  readNtfyConfig,
  writeNotificationEvents,
  writeNtfyConfig,
} from "./notifier.js";
import { validNtfyUrl } from "./ntfy.js";
import {
  deletePushSubscription,
  getOrCreateVapidKeys,
  listPushSubscriptions,
  upsertPushSubscription,
} from "./webpush.js";

export interface NotificationRoutesDeps {
  db: DatabaseSync;
  secretsKey: Buffer;
  notifier: Notifier;
}

async function jsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function validPushSubscription(body: Record<string, unknown> | null): {
  endpoint: string;
  keys: { p256dh: string; auth: string };
} | null {
  if (body === null || typeof body.endpoint !== "string" || body.endpoint === "") return null;
  const keys = body.keys;
  if (typeof keys !== "object" || keys === null || Array.isArray(keys)) return null;
  const { p256dh, auth } = keys as Record<string, unknown>;
  if (typeof p256dh !== "string" || p256dh === "" || typeof auth !== "string" || auth === "") return null;
  return { endpoint: body.endpoint, keys: { p256dh, auth } };
}

export function notificationRoutes(deps: NotificationRoutesDeps): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const userId = c.get("user").id;
    const ntfy = readNtfyConfig(deps.db, userId);
    return c.json({
      ntfy: { url: ntfy.url, hasToken: ntfy.tokenEnc !== "" },
      vapidPublicKey: getOrCreateVapidKeys(deps.db, deps.secretsKey).publicKey,
      subscriptions: listPushSubscriptions(deps.db, userId).map((subscription) => ({
        id: subscription.id,
        userAgent: subscription.userAgent,
        createdAt: subscription.createdAt,
      })),
      events: readNotificationEvents(deps.db, userId),
    });
  });

  app.put("/ntfy", async (c) => {
    const body = await jsonBody(c);
    if (body === null || typeof body.url !== "string") return c.json({ error: "url must be a string" }, 400);
    if (body.url !== "" && !validNtfyUrl(body.url)) {
      return c.json({ error: "url must be an http(s) URL or empty" }, 400);
    }
    if (body.token !== undefined && typeof body.token !== "string") {
      return c.json({ error: "token must be a string" }, 400);
    }
    const userId = c.get("user").id;
    if (body.url === "") {
      writeNtfyConfig(deps.db, userId, { url: "", tokenEnc: "" });
    } else {
      const existing = readNtfyConfig(deps.db, userId);
      const tokenEnc =
        body.token === undefined
          ? existing.tokenEnc
          : body.token === ""
            ? ""
            : encryptSecret(deps.secretsKey, body.token);
      writeNtfyConfig(deps.db, userId, { url: body.url, tokenEnc });
    }
    const stored = readNtfyConfig(deps.db, userId);
    return c.json({ ntfy: { url: stored.url, hasToken: stored.tokenEnc !== "" } });
  });

  app.post("/push", async (c) => {
    const subscription = validPushSubscription(await jsonBody(c));
    if (subscription === null) return c.json({ error: "endpoint and keys are required" }, 400);
    const record = upsertPushSubscription(deps.db, c.get("user").id, subscription, c.req.header("user-agent") ?? "");
    return c.json({ subscription: { id: record.id, userAgent: record.userAgent, createdAt: record.createdAt } }, 201);
  });

  app.delete("/push/:id", (c) => {
    if (!deletePushSubscription(deps.db, c.get("user").id, c.req.param("id"))) {
      return c.json({ error: "subscription not found" }, 404);
    }
    return c.body(null, 204);
  });

  app.patch("/events", async (c) => {
    const body = await jsonBody(c);
    if (body === null) return c.json({ error: "invalid JSON body" }, 400);
    for (const key of ["jobDone", "jobFailed"] as const) {
      if (body[key] !== undefined && typeof body[key] !== "boolean") {
        return c.json({ error: `${key} must be boolean` }, 400);
      }
    }
    const userId = c.get("user").id;
    writeNotificationEvents(deps.db, userId, {
      ...(typeof body.jobDone === "boolean" ? { jobDone: body.jobDone } : {}),
      ...(typeof body.jobFailed === "boolean" ? { jobFailed: body.jobFailed } : {}),
    });
    return c.json({ events: readNotificationEvents(deps.db, userId) });
  });

  app.post("/test", async (c) => {
    const userId = c.get("user").id;
    await deps.notifier.notifyUser(userId, {
      title: "Studium test",
      body: "Notifications are working.",
      url: "/",
      tags: ["bell"],
    });
    return c.json({ ok: true });
  });

  return app;
}
