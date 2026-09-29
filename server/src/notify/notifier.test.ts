import { randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { updateInstanceSettings } from "../accounts/settings.js";
import { createUser } from "../accounts/users.js";
import { encryptSecret } from "../db/crypto.js";
import { migrate, openDb } from "../db/db.js";
import type { safeFetch } from "../ingest/safe-fetch.js";
import { Notifier, writeNotificationEvents, writeNtfyConfig } from "./notifier.js";

let db: DatabaseSync;
const secretsKey = randomBytes(32);

beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
});

function notifier(fetchImpl: typeof fetch): Notifier {
  const safeFetchImpl = async (url: string, options: Parameters<typeof safeFetch>[1]) => {
    const response = await fetchImpl(url, {
      method: options?.method,
      headers: options?.headers,
      body: options?.body,
    });
    return {
      url,
      status: response.status,
      ok: response.ok,
      headers: response.headers,
      contentType: response.headers.get("content-type"),
      bytes: new Uint8Array(),
    };
  };
  return new Notifier({
    db,
    secretsKey,
    fetchImpl,
    safeFetchImpl: safeFetchImpl as typeof safeFetch,
    logger: () => undefined,
  });
}

describe("Notifier", () => {
  it("sends the ntfy topic with an absolute click url", async () => {
    const user = await createUser(db, { username: "learner", role: "USER" });
    updateInstanceSettings(db, { instanceUrl: "https://notes.example" });
    writeNtfyConfig(db, user.id, {
      url: "https://ntfy.sh/studium-learner",
      tokenEnc: encryptSecret(secretsKey, "tk_secret"),
    });
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response("", { status: 200 }));

    await notifier(fetchImpl as unknown as typeof fetch).notifyUser(user.id, {
      title: "Job finished",
      body: "Draft ready",
      url: "/s/linear-algebra",
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as [string, RequestInit | undefined];
    expect(call[0]).toBe("https://ntfy.sh/studium-learner");
    expect(call[1]?.headers).toMatchObject({
      Title: "Job finished",
      Click: "https://notes.example/s/linear-algebra",
      Authorization: "Bearer tk_secret",
    });
  });

  it("never throws when a channel fails", async () => {
    const user = await createUser(db, { username: "learner", role: "USER" });
    writeNtfyConfig(db, user.id, { url: "https://ntfy.sh/x", tokenEnc: "" });
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => {
      throw new Error("network down");
    });
    await expect(
      notifier(fetchImpl as unknown as typeof fetch).notifyUser(user.id, { title: "t", body: "b" }),
    ).resolves.toBeUndefined();
  });

  it("honours the per-event opt-out", async () => {
    const user = await createUser(db, { username: "learner", role: "USER" });
    writeNtfyConfig(db, user.id, { url: "https://ntfy.sh/x", tokenEnc: "" });
    writeNotificationEvents(db, user.id, { jobDone: false });
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response("", { status: 200 }));

    await notifier(fetchImpl as unknown as typeof fetch).notifyUser(user.id, {
      title: "Job finished",
      body: "Draft ready",
      event: "jobDone",
    });
    expect(fetchImpl).not.toHaveBeenCalled();

    await notifier(fetchImpl as unknown as typeof fetch).notifyUser(user.id, {
      title: "Job failed",
      body: "boom",
      event: "jobFailed",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("notifies every active admin", async () => {
    const adminA = await createUser(db, { username: "admin-a", role: "ADMIN" });
    const adminB = await createUser(db, { username: "admin-b", role: "ADMIN" });
    const learner = await createUser(db, { username: "learner", role: "USER" });
    for (const user of [adminA, adminB, learner]) {
      writeNtfyConfig(db, user.id, { url: "https://ntfy.sh/x", tokenEnc: "" });
    }
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response("", { status: 200 }));

    await notifier(fetchImpl as unknown as typeof fetch).notifyAdmins({ title: "Backup failed", body: "restic" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
