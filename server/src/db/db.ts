import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { migrations } from "./migrations.js";

export function openDb(file: string): DatabaseSync {
  if (file !== ":memory:") mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;");
  return db;
}

export function migrate(db: DatabaseSync): void {
  const row = db.prepare("PRAGMA user_version").get() as { user_version: number };
  let version = row.user_version;
  for (let index = version; index < migrations.length; index += 1) {
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(migrations[index] ?? "");
      db.exec(`PRAGMA user_version=${index + 1}`);
      db.exec("COMMIT");
      version = index + 1;
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}
