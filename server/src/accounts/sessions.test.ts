import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { migrate, openDb } from "../db/db.js";
import { createSession, listSessions, resolveSession, revokeAllSessions, revokeSession } from "./sessions.js";
import { createUser, updateUser } from "./users.js";

let db: DatabaseSync;
let tempDir: string;
beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-sessions-"));
  db = openDb(path.join(tempDir, "studium.db"));
  migrate(db);
});
afterEach(async () => {
  db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("sessions", () => {
  it("creates and resolves a hashed 30-day session", async () => {
    const user = await createUser(db, { username: "learner", role: "USER" });
    const created = createSession(db, user.id, { userAgent: "test", ip: "127.0.0.1" });
    expect(created.token).not.toBe("");
    expect(resolveSession(db, created.token)).toMatchObject({ user: { id: user.id }, session: { id: created.id } });
    expect(db.prepare("SELECT token_hash FROM sessions WHERE id = ?").get(created.id)).not.toEqual({
      token_hash: created.token,
    });
  });

  it("rejects expired and archived sessions and slides near-expiry sessions", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const user = await createUser(db, { username: "learner", role: "USER" });
      const expired = createSession(db, user.id, { userAgent: "", ip: "" });
      db.prepare("UPDATE sessions SET expires_at = ? WHERE id = ?").run("2025-12-31T23:59:59.000Z", expired.id);
      expect(resolveSession(db, expired.token)).toBeNull();

      const sliding = createSession(db, user.id, { userAgent: "", ip: "" });
      db.prepare("UPDATE sessions SET expires_at = ?, last_used_at = ? WHERE id = ?").run(
        "2026-01-02T00:00:00.000Z",
        "2025-12-31T23:00:00.000Z",
        sliding.id,
      );
      const resolved = resolveSession(db, sliding.token);
      expect(Date.parse(resolved?.session.expiresAt ?? "")).toBeGreaterThan(Date.parse("2026-01-20T00:00:00Z"));
      updateUser(db, user.id, { state: "ARCHIVED" });
      expect(resolveSession(db, sliding.token)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("lists and revokes sessions", async () => {
    const user = await createUser(db, { username: "learner", role: "USER" });
    const first = createSession(db, user.id, { userAgent: "one", ip: "" });
    const second = createSession(db, user.id, { userAgent: "two", ip: "" });
    expect(listSessions(db, user.id)).toHaveLength(2);
    expect(revokeSession(db, user.id, first.id)).toBe(true);
    expect(revokeAllSessions(db, user.id, second.id)).toBe(0);
    expect(listSessions(db, user.id).map((session) => session.id)).toEqual([second.id]);
  });
});
