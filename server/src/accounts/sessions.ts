import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { User } from "./users.js";
import { getUserById } from "./users.js";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;
const SLIDE_THRESHOLD_MS = 15 * 24 * 60 * 60 * 1_000;
const LAST_USED_GRANULARITY_MS = 60 * 1_000;

export interface Session {
  id: string;
  userId: number;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
}

interface SessionRow {
  id: string;
  user_id: number;
  user_agent: string;
  ip: string;
  created_at: string;
  last_used_at: string;
  expires_at: string;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toSession(row: SessionRow): Session {
  return {
    id: row.id,
    userId: row.user_id,
    userAgent: row.user_agent,
    ip: row.ip,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
  };
}

export function createSession(
  db: DatabaseSync,
  userId: number,
  input: { userAgent: string; ip: string },
): { id: string; token: string; expiresAt: string } {
  const id = randomBytes(16).toString("hex");
  const token = randomBytes(32).toString("base64url");
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_DURATION_MS).toISOString();
  const nowText = now.toISOString();
  db.prepare(
    `INSERT INTO sessions
      (id, user_id, token_hash, user_agent, ip, created_at, last_used_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, digest(token), input.userAgent, input.ip, nowText, nowText, expiresAt);
  return { id, token, expiresAt };
}

export function resolveSession(db: DatabaseSync, token: string): { session: Session; user: User } | null {
  const row = db.prepare("SELECT * FROM sessions WHERE token_hash = ?").get(digest(token)) as SessionRow | undefined;
  if (row === undefined) return null;
  const now = Date.now();
  if (Date.parse(row.expires_at) <= now) return null;
  const user = getUserById(db, row.user_id);
  if (user === null || user.state === "ARCHIVED") return null;

  let lastUsedAt = row.last_used_at;
  let expiresAt = row.expires_at;
  const shouldTouch = now - Date.parse(row.last_used_at) >= LAST_USED_GRANULARITY_MS;
  const shouldSlide = Date.parse(row.expires_at) - now < SLIDE_THRESHOLD_MS;
  if (shouldTouch || shouldSlide) {
    if (shouldTouch) lastUsedAt = new Date(now).toISOString();
    if (shouldSlide) expiresAt = new Date(now + SESSION_DURATION_MS).toISOString();
    db.prepare("UPDATE sessions SET last_used_at = ?, expires_at = ? WHERE id = ?").run(lastUsedAt, expiresAt, row.id);
  }
  return { session: toSession({ ...row, last_used_at: lastUsedAt, expires_at: expiresAt }), user };
}

export function listSessions(db: DatabaseSync, userId: number): Session[] {
  const rows = db
    .prepare("SELECT * FROM sessions WHERE user_id = ? ORDER BY created_at DESC")
    .all(userId) as unknown as SessionRow[];
  return rows.map(toSession);
}

export function revokeSession(db: DatabaseSync, userId: number, id: string): boolean {
  return db.prepare("DELETE FROM sessions WHERE user_id = ? AND id = ?").run(userId, id).changes > 0;
}

export function revokeAllSessions(db: DatabaseSync, userId: number, exceptId?: string): number {
  const result =
    exceptId === undefined
      ? db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId)
      : db.prepare("DELETE FROM sessions WHERE user_id = ? AND id <> ?").run(userId, exceptId);
  return Number(result.changes);
}
