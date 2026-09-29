import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import webpush from "web-push";
import { getInstanceSettings } from "../accounts/settings.js";
import { decryptSecret, encryptSecret } from "../db/crypto.js";
import type { NotificationPayload } from "./types.js";

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface PushSubscriptionRecord {
  id: string;
  userId: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent: string;
  createdAt: string;
}

export interface PushSubscriptionView {
  id: string;
  endpoint: string;
  userAgent: string;
  createdAt: string;
}

type PushSubscriptionInput = { endpoint: string; keys: { p256dh: string; auth: string } };
type VapidDetails = { subject: string; publicKey: string; privateKey: string };

export type SendPush = (
  subscription: PushSubscriptionInput,
  payload: string,
  options: { vapidDetails: VapidDetails; timeout: number },
) => Promise<unknown>;

export interface PushDeps {
  send?: SendPush;
  /** Absolute base for the VAPID subject; falls back to a mailto for localhost. */
  instanceUrl?: string;
}

export type PushOutcome = "sent" | "gone" | "error";

export class PushSubscriptionConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PushSubscriptionConflictError";
  }
}

interface SubscriptionRow {
  id: string;
  user_id: number;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string;
  created_at: string;
}

function toRecord(row: SubscriptionRow): PushSubscriptionRecord {
  return {
    id: row.id,
    userId: row.user_id,
    endpoint: row.endpoint,
    p256dh: row.p256dh,
    auth: row.auth,
    userAgent: row.user_agent,
    createdAt: row.created_at,
  };
}

const defaultSend: SendPush = (subscription, payload, options) =>
  webpush.sendNotification(subscription, payload, options);

/** The VAPID keypair, generating and persisting it once. The private key is always encrypted. */
export function getOrCreateVapidKeys(db: DatabaseSync, secretsKey: Buffer): VapidKeys {
  const row = db.prepare("SELECT value FROM instance_settings WHERE key = 'vapid'").get() as
    | { value: string }
    | undefined;
  if (row !== undefined) {
    const parsed = JSON.parse(row.value) as { publicKey?: unknown; privateKeyEnc?: unknown };
    if (typeof parsed.publicKey === "string" && typeof parsed.privateKeyEnc === "string") {
      return { publicKey: parsed.publicKey, privateKey: decryptSecret(secretsKey, parsed.privateKeyEnc) };
    }
  }
  const generated = webpush.generateVAPIDKeys();
  db.prepare("INSERT INTO instance_settings (key, value) VALUES ('vapid', ?)").run(
    JSON.stringify({ publicKey: generated.publicKey, privateKeyEnc: encryptSecret(secretsKey, generated.privateKey) }),
  );
  return { publicKey: generated.publicKey, privateKey: generated.privateKey };
}

export function listPushSubscriptions(db: DatabaseSync, userId: number): PushSubscriptionRecord[] {
  const rows = db
    .prepare("SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY created_at")
    .all(userId) as unknown as SubscriptionRow[];
  return rows.map(toRecord);
}

export function upsertPushSubscription(
  db: DatabaseSync,
  userId: number,
  input: PushSubscriptionInput,
  userAgent: string,
): PushSubscriptionRecord {
  const existing = db.prepare("SELECT id, user_id FROM push_subscriptions WHERE endpoint = ?").get(input.endpoint) as
    | { id: string; user_id: number }
    | undefined;
  if (existing !== undefined) {
    if (existing.user_id !== userId) {
      throw new PushSubscriptionConflictError("push endpoint is already registered to another user");
    }
    db.prepare("UPDATE push_subscriptions SET p256dh = ?, auth = ?, user_agent = ? WHERE id = ?").run(
      input.keys.p256dh,
      input.keys.auth,
      userAgent,
      existing.id,
    );
    return toRecord(
      db.prepare("SELECT * FROM push_subscriptions WHERE id = ?").get(existing.id) as unknown as SubscriptionRow,
    );
  }
  if (listPushSubscriptions(db, userId).length >= 10) {
    throw new PushSubscriptionConflictError("push subscription limit reached");
  }
  const id = randomBytes(16).toString("hex");
  db.prepare(
    `INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth, user_agent, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, input.endpoint, input.keys.p256dh, input.keys.auth, userAgent, new Date().toISOString());
  return toRecord(db.prepare("SELECT * FROM push_subscriptions WHERE id = ?").get(id) as unknown as SubscriptionRow);
}

export function deletePushSubscription(db: DatabaseSync, userId: number, id: string): boolean {
  return db.prepare("DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?").run(id, userId).changes > 0;
}

function vapidSubject(instanceUrl: string): string {
  return instanceUrl === "" ? "mailto:admin@localhost" : instanceUrl;
}

/**
 * Send one push. A 404/410 from the push service means the subscription is dead, so it is
 * deleted. Every other failure is reported back to the caller to log; nothing is thrown.
 */
export async function dispatchPush(
  db: DatabaseSync,
  secretsKey: Buffer,
  subscription: PushSubscriptionRecord,
  notification: NotificationPayload,
  deps: PushDeps = {},
): Promise<PushOutcome> {
  const send = deps.send ?? defaultSend;
  const keys = getOrCreateVapidKeys(db, secretsKey);
  const instanceUrl = deps.instanceUrl ?? getInstanceSettings(db).instanceUrl;
  try {
    await send(
      { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
      JSON.stringify(notification),
      {
        vapidDetails: { subject: vapidSubject(instanceUrl), publicKey: keys.publicKey, privateKey: keys.privateKey },
        timeout: 10_000,
      },
    );
    return "sent";
  } catch (error) {
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (statusCode === 404 || statusCode === 410) {
      db.prepare("DELETE FROM push_subscriptions WHERE id = ?").run(subscription.id);
      return "gone";
    }
    return "error";
  }
}
