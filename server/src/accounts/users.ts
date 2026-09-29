import type { DatabaseSync } from "node:sqlite";
import { hashPassword, verifyPassword } from "../auth/password.js";

export const USERNAME_PATTERN = /^[a-z0-9][a-z0-9_-]{1,31}$/;

export type UserRole = "ADMIN" | "USER";
export type UserState = "NORMAL" | "ARCHIVED";

export interface User {
  id: number;
  username: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  role: UserRole;
  state: UserState;
  aiEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  hasPassword: boolean;
}

interface UserRow {
  id: number;
  username: string;
  display_name: string;
  email: string;
  avatar_url: string;
  role: UserRole;
  state: UserState;
  password_hash: string | null;
  ai_enabled: number;
  created_at: string;
  updated_at: string;
}

export interface CreateUserInput {
  username: string;
  password?: string;
  role: UserRole;
  displayName?: string;
  email?: string;
  aiEnabled?: boolean;
}

export interface UserPatch {
  displayName?: string;
  email?: string;
  avatarUrl?: string;
  role?: UserRole;
  state?: UserState;
  aiEnabled?: boolean;
  passwordHash?: string | null;
}

function toUser(row: UserRow): User {
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    email: row.email,
    avatarUrl: row.avatar_url,
    role: row.role,
    state: row.state,
    aiEnabled: row.ai_enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    hasPassword: row.password_hash !== null,
  };
}

const USER_COLUMNS = `id, username, display_name, email, avatar_url, role, state,
  password_hash, ai_enabled, created_at, updated_at`;

export async function createUser(db: DatabaseSync, input: CreateUserInput): Promise<User> {
  if (!USERNAME_PATTERN.test(input.username)) {
    throw new Error("username must match ^[a-z0-9][a-z0-9_-]{1,31}$");
  }
  if (input.password !== undefined && input.password.length < 8) {
    throw new Error("password must be at least 8 characters");
  }
  const passwordHash = input.password === undefined ? null : await hashPassword(input.password);
  const now = new Date().toISOString();
  const result = db
    .prepare(
      `INSERT INTO users
        (username, display_name, email, role, password_hash, ai_enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      input.username,
      input.displayName ?? "",
      input.email ?? "",
      input.role,
      passwordHash,
      input.aiEnabled === false ? 0 : 1,
      now,
      now,
    );
  const user = getUserById(db, Number(result.lastInsertRowid));
  if (user === null) throw new Error("failed to create user");
  return user;
}

export function getUserById(db: DatabaseSync, id: number): User | null {
  const row = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE id = ?`).get(id) as UserRow | undefined;
  return row === undefined ? null : toUser(row);
}

export function getUserByUsername(db: DatabaseSync, username: string): User | null {
  const row = db.prepare(`SELECT ${USER_COLUMNS} FROM users WHERE username = ?`).get(username) as UserRow | undefined;
  return row === undefined ? null : toUser(row);
}

export function getUserByEmail(db: DatabaseSync, email: string): User | null {
  if (email.trim() === "") return null;
  const row = db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email <> '' AND email = ? COLLATE NOCASE`)
    .get(email) as UserRow | undefined;
  return row === undefined ? null : toUser(row);
}

export function listUsersByEmail(db: DatabaseSync, email: string): User[] {
  if (email.trim() === "") return [];
  const rows = db
    .prepare(`SELECT ${USER_COLUMNS} FROM users WHERE email <> '' AND email = ? COLLATE NOCASE ORDER BY id`)
    .all(email) as unknown as UserRow[];
  return rows.map(toUser);
}

export function emailBelongsToAnotherUser(db: DatabaseSync, email: string, userId?: number): boolean {
  if (email.trim() === "") return false;
  const row = db
    .prepare(`SELECT id FROM users WHERE email <> '' AND email = ? COLLATE NOCASE AND (? IS NULL OR id <> ?) LIMIT 1`)
    .get(email, userId ?? null, userId ?? null);
  return row !== undefined;
}

export function listUsers(db: DatabaseSync): User[] {
  const rows = db.prepare(`SELECT ${USER_COLUMNS} FROM users ORDER BY id`).all() as unknown as UserRow[];
  return rows.map(toUser);
}

export function updateUser(db: DatabaseSync, id: number, patch: UserPatch): User | null {
  const columns: string[] = [];
  const values: Array<string | number | null> = [];
  const add = (column: string, value: string | number | null) => {
    columns.push(`${column} = ?`);
    values.push(value);
  };
  if (patch.displayName !== undefined) add("display_name", patch.displayName);
  if (patch.email !== undefined) add("email", patch.email);
  if (patch.avatarUrl !== undefined) add("avatar_url", patch.avatarUrl);
  if (patch.role !== undefined) add("role", patch.role);
  if (patch.state !== undefined) add("state", patch.state);
  if (patch.aiEnabled !== undefined) add("ai_enabled", patch.aiEnabled ? 1 : 0);
  if (patch.passwordHash !== undefined) add("password_hash", patch.passwordHash);
  if (columns.length === 0) return getUserById(db, id);
  add("updated_at", new Date().toISOString());
  db.prepare(`UPDATE users SET ${columns.join(", ")} WHERE id = ?`).run(...values, id);
  return getUserById(db, id);
}

export function countAdmins(db: DatabaseSync): number {
  const row = db.prepare("SELECT count(*) AS count FROM users WHERE role = 'ADMIN' AND state = 'NORMAL'").get() as {
    count: number;
  };
  return row.count;
}

export async function verifyUserPassword(db: DatabaseSync, userId: number, password: string): Promise<boolean> {
  const row = db.prepare("SELECT password_hash FROM users WHERE id = ?").get(userId) as
    | { password_hash: string | null }
    | undefined;
  return row?.password_hash !== null && row?.password_hash !== undefined
    ? verifyPassword(password, row.password_hash)
    : false;
}

export function deleteUser(db: DatabaseSync, id: number): boolean {
  return db.prepare("DELETE FROM users WHERE id = ?").run(id).changes > 0;
}
