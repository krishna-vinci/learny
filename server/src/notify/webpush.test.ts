import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createUser } from "../accounts/users.js";
import { migrate, openDb } from "../db/db.js";
import { dispatchPush, getOrCreateVapidKeys, listPushSubscriptions, upsertPushSubscription } from "./webpush.js";

let db: DatabaseSync;
let userId: number;
const secretsKey = randomBytes(32);
const endpoint = "https://push.example/abc123";

beforeEach(async () => {
  db = openDb(":memory:");
  migrate(db);
  userId = (await createUser(db, { username: "learner", role: "USER" })).id;
});

describe("web push", () => {
  it("generates and persists one VAPID keypair", () => {
    const first = getOrCreateVapidKeys(db, secretsKey);
    const second = getOrCreateVapidKeys(db, secretsKey);
    expect(first.publicKey).toBe(second.publicKey);
    expect(first.privateKey).toBe(second.privateKey);
    const stored = JSON.parse(
      (db.prepare("SELECT value FROM instance_settings WHERE key = 'vapid'").get() as { value: string }).value,
    ) as { privateKeyEnc: string };
    expect(stored.privateKeyEnc).toMatch(/^v1:/);
    expect(stored.privateKeyEnc).not.toContain(first.privateKey);
  });

  it("dispatches with a stubbed send and deletes a 410 subscription", async () => {
    const subscription = upsertPushSubscription(
      db,
      userId,
      { endpoint, keys: { p256dh: "p256dh-key", auth: "auth-key" } },
      "Mozilla/5.0",
    );

    const sent: Array<{ subscription: unknown; payload: string; options: { vapidDetails: { publicKey: string } } }> =
      [];
    const send = vi.fn(
      async (
        subscription: unknown,
        payload: string,
        options: { vapidDetails: { publicKey: string } },
      ): Promise<unknown> => {
        sent.push({ subscription, payload, options });
        return { statusCode: 201 };
      },
    );
    const outcome = await dispatchPush(
      db,
      secretsKey,
      subscription,
      { title: "Job finished", body: "Draft ready", url: "https://notes.example/s/linear-algebra" },
      { send },
    );
    expect(outcome).toBe("sent");
    const call = sent[0] as {
      subscription: unknown;
      payload: string;
      options: { vapidDetails: { publicKey: string } };
    };
    expect(call.subscription).toEqual({ endpoint, keys: { p256dh: "p256dh-key", auth: "auth-key" } });
    expect(JSON.parse(call.payload)).toEqual({
      title: "Job finished",
      body: "Draft ready",
      url: "https://notes.example/s/linear-algebra",
    });
    expect(call.options.vapidDetails.publicKey).toBe(getOrCreateVapidKeys(db, secretsKey).publicKey);
    expect(send).toHaveBeenCalledTimes(1);

    const gone = vi.fn(async (_subscription: unknown, _payload: string, _options: unknown) => {
      throw Object.assign(new Error("subscription gone"), { statusCode: 410 });
    });
    expect(await dispatchPush(db, secretsKey, subscription, { title: "t", body: "b" }, { send: gone })).toBe("gone");
    expect(listPushSubscriptions(db, userId)).toHaveLength(0);
  });

  it("reports other send failures without throwing", async () => {
    const subscription = upsertPushSubscription(db, userId, { endpoint, keys: { p256dh: "p", auth: "a" } }, "");
    const send = vi.fn(async (_subscription: unknown, _payload: string, _options: unknown) => {
      throw new Error("network down");
    });
    expect(await dispatchPush(db, secretsKey, subscription, { title: "t", body: "b" }, { send })).toBe("error");
    expect(listPushSubscriptions(db, userId)).toHaveLength(1);
  });
});
