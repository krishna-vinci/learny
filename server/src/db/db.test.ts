import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { migrate, openDb } from "./db.js";
import { deriveKey, loadInstanceSecret } from "./secret.js";

const dirs: string[] = [];

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("database", () => {
  it("migrates idempotently and enables the required pragmas", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-db-"));
    dirs.push(dir);
    const db = openDb(path.join(dir, "studium.db"));
    migrate(db);
    migrate(db);
    expect(db.prepare("PRAGMA user_version").get()).toEqual({ user_version: 4 });
    expect(db.prepare("PRAGMA foreign_keys").get()).toEqual({ foreign_keys: 1 });
    expect(db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((row) => (row as { name: string }).name);
    expect(tables).toEqual(expect.arrayContaining(["user_settings", "push_subscriptions"]));
    db.close();
  });

  it("creates and reuses a mode-0600 instance secret", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-secret-"));
    dirs.push(dir);
    const first = loadInstanceSecret(dir, {});
    const second = loadInstanceSecret(dir, {});
    expect(first).toEqual(second);
    expect((await fs.stat(path.join(dir, ".secret"))).mode & 0o777).toBe(0o600);
    expect(deriveKey(first, "test")).toHaveLength(32);
  });
});
