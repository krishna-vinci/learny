import type { DatabaseSync } from "node:sqlite";
import { getInstanceSettings } from "../accounts/settings.js";
import { getUserById, listUsers } from "../accounts/users.js";
import { decryptSecret } from "../db/crypto.js";
import { type NtfyConfig, sendNtfy } from "./ntfy.js";
import { DEFAULT_NOTIFICATION_EVENTS, type NotificationEvent, type NotificationEventSettings } from "./types.js";
import { dispatchPush, listPushSubscriptions, type SendPush } from "./webpush.js";

export interface UserNotification {
  title: string;
  body: string;
  /** Path such as `/s/<set>` or `/jobs`; made absolute with the instance URL. */
  url?: string;
  tags?: string[];
  /** When set, the user's per-event opt-in decides whether anything is sent. */
  event?: NotificationEvent;
}

export interface NotifierDeps {
  db: DatabaseSync;
  secretsKey: Buffer;
  fetchImpl?: typeof fetch;
  sendPush?: SendPush;
  logger?: (message: string) => void;
}

export interface StoredNtfyConfig {
  url: string;
  tokenEnc: string;
}

const NTFY_KEY = "ntfy";
const EVENTS_KEY = "notification_events";
const EMPTY_NTFY: StoredNtfyConfig = { url: "", tokenEnc: "" };

export function readNtfyConfig(db: DatabaseSync, userId: number): StoredNtfyConfig {
  const row = db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = ?").get(userId, NTFY_KEY) as
    | { value: string }
    | undefined;
  if (row === undefined) return { ...EMPTY_NTFY };
  try {
    const parsed = JSON.parse(row.value) as { url?: unknown; tokenEnc?: unknown };
    return {
      url: typeof parsed.url === "string" ? parsed.url : "",
      tokenEnc: typeof parsed.tokenEnc === "string" ? parsed.tokenEnc : "",
    };
  } catch {
    return { ...EMPTY_NTFY };
  }
}

export function writeNtfyConfig(db: DatabaseSync, userId: number, config: StoredNtfyConfig): void {
  writeUserSetting(db, userId, NTFY_KEY, JSON.stringify(config));
}

export function readNotificationEvents(db: DatabaseSync, userId: number): NotificationEventSettings {
  const row = db.prepare("SELECT value FROM user_settings WHERE user_id = ? AND key = ?").get(userId, EVENTS_KEY) as
    | { value: string }
    | undefined;
  if (row === undefined) return { ...DEFAULT_NOTIFICATION_EVENTS };
  try {
    const parsed = JSON.parse(row.value) as { jobDone?: unknown; jobFailed?: unknown };
    return {
      jobDone: parsed.jobDone !== false,
      jobFailed: parsed.jobFailed !== false,
    };
  } catch {
    return { ...DEFAULT_NOTIFICATION_EVENTS };
  }
}

export function writeNotificationEvents(
  db: DatabaseSync,
  userId: number,
  patch: Partial<NotificationEventSettings>,
): void {
  const next = { ...readNotificationEvents(db, userId), ...patch };
  writeUserSetting(db, userId, EVENTS_KEY, JSON.stringify(next));
}

export function writeUserSetting(db: DatabaseSync, userId: number, key: string, value: string): void {
  db.prepare(
    `INSERT INTO user_settings (user_id, key, value) VALUES (?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value`,
  ).run(userId, key, value);
}

function absoluteUrl(instanceUrl: string, url: string | undefined): string | undefined {
  if (url === undefined || url === "") return undefined;
  if (instanceUrl === "") return url;
  try {
    return new URL(url, instanceUrl).toString();
  } catch {
    return url;
  }
}

function ntfyConfigFor(db: DatabaseSync, secretsKey: Buffer, userId: number): NtfyConfig | null {
  const stored = readNtfyConfig(db, userId);
  if (stored.url === "") return null;
  const token = stored.tokenEnc === "" ? undefined : decryptSecret(secretsKey, stored.tokenEnc);
  return { url: stored.url, ...(token === undefined ? {} : { token }) };
}

/**
 * Delivers notifications over every channel a user has configured. Failures are logged
 * and swallowed so a broken ntfy topic or push service never breaks a job.
 */
export class Notifier {
  readonly #db: DatabaseSync;
  readonly #secretsKey: Buffer;
  readonly #fetchImpl: typeof fetch;
  readonly #sendPush: SendPush | undefined;
  readonly #logger: (message: string) => void;

  constructor(deps: NotifierDeps) {
    this.#db = deps.db;
    this.#secretsKey = deps.secretsKey;
    this.#fetchImpl = deps.fetchImpl ?? fetch;
    this.#sendPush = deps.sendPush;
    this.#logger = deps.logger ?? ((message) => console.warn(`studium: ${message}`));
  }

  async notifyUser(userId: number, notification: UserNotification): Promise<void> {
    try {
      if (notification.event !== undefined && !readNotificationEvents(this.#db, userId)[notification.event]) return;
      const user = getUserById(this.#db, userId);
      if (user === null) return;
      const instanceUrl = getInstanceSettings(this.#db).instanceUrl;
      const clickUrl = absoluteUrl(instanceUrl, notification.url);
      const payload = {
        title: notification.title,
        body: notification.body,
        ...(notification.tags === undefined ? {} : { tags: notification.tags }),
        ...(clickUrl === undefined ? {} : { url: clickUrl }),
      };

      const ntfy = ntfyConfigFor(this.#db, this.#secretsKey, userId);
      if (ntfy !== null) {
        try {
          await sendNtfy(ntfy, payload, { fetchImpl: this.#fetchImpl });
        } catch (error) {
          this.#logger(`ntfy notification failed for ${user.username}: ${errorMessage(error)}`);
        }
      }

      for (const subscription of listPushSubscriptions(this.#db, userId)) {
        try {
          const outcome = await dispatchPush(this.#db, this.#secretsKey, subscription, payload, {
            ...(this.#sendPush === undefined ? {} : { send: this.#sendPush }),
            instanceUrl,
          });
          if (outcome === "error") {
            this.#logger(`web push notification failed for ${user.username} (${subscription.id})`);
          }
        } catch (error) {
          this.#logger(`web push notification failed for ${user.username}: ${errorMessage(error)}`);
        }
      }
    } catch (error) {
      this.#logger(`notification failed for user ${userId}: ${errorMessage(error)}`);
    }
  }

  /** Notify every active admin, e.g. when a scheduled backup fails. */
  async notifyAdmins(notification: UserNotification): Promise<void> {
    const admins = listUsers(this.#db).filter((user) => user.role === "ADMIN" && user.state === "NORMAL");
    await Promise.all(admins.map((admin) => this.notifyUser(admin.id, notification)));
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
