import { createHash, randomBytes } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import type { User } from "./users.js";
import { getUserById } from "./users.js";

export const ACCESS_TOKEN_PREFIX = "studium_pat_";

export interface AccessToken {
  id: string;
  userId: number;
  description: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

interface TokenRow {
  id: string;
  user_id: number;
  description: string;
  created_at: string;
  last_used_at: string | null;
  expires_at: string | null;
}

function digest(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function toToken(row: TokenRow): AccessToken {
  return {
    id: row.id,
    userId: row.user_id,
    description: row.description,
    createdAt: row.created_at,
    lastUsedAt: row.last_used_at,
    expiresAt: row.expires_at,
  };
}

export function createAccessToken(
  db: DatabaseSync,
  userId: number,
  input: { description: string; expiresInDays?: number },
): { id: string; token: string } {
  const id = randomBytes(16).toString("hex");
  const token = `${ACCESS_TOKEN_PREFIX}${randomBytes(32).toString("base64url")}`;
  const now = new Date();
  const expiresAt =
    input.expiresInDays === undefined
      ? null
      : new Date(now.getTime() + input.expiresInDays * 24 * 60 * 60 * 1_000).toISOString();
  db.prepare(
    `INSERT INTO access_tokens (id, user_id, description, token_hash, created_at, expires_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(id, userId, input.description, digest(token), now.toISOString(), expiresAt);
  return { id, token };
}

export function resolveAccessToken(db: DatabaseSync, token: string): { accessToken: AccessToken; user: User } | null {
  if (!token.startsWith(ACCESS_TOKEN_PREFIX)) return null;
  const row = db.prepare("SELECT * FROM access_tokens WHERE token_hash = ?").get(digest(token)) as TokenRow | undefined;
  if (row === undefined || (row.expires_at !== null && Date.parse(row.expires_at) <= Date.now())) return null;
  const user = getUserById(db, row.user_id);
  if (user === null || user.state === "ARCHIVED") return null;
  const lastUsedAt = new Date().toISOString();
  db.prepare("UPDATE access_tokens SET last_used_at = ? WHERE id = ?").run(lastUsedAt, row.id);
  return { accessToken: toToken({ ...row, last_used_at: lastUsedAt }), user };
}

export function listAccessTokens(db: DatabaseSync, userId: number): AccessToken[] {
  const rows = db
    .prepare(
      "SELECT id, user_id, description, created_at, last_used_at, expires_at FROM access_tokens WHERE user_id = ? ORDER BY created_at DESC",
    )
    .all(userId) as unknown as TokenRow[];
  return rows.map(toToken);
}

export function deleteAccessToken(db: DatabaseSync, userId: number, id: string): boolean {
  return db.prepare("DELETE FROM access_tokens WHERE user_id = ? AND id = ?").run(userId, id).changes > 0;
}
