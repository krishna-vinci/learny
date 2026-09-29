import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb } from "../db/db.js";
import { countAdmins, createUser, getUserByEmail, getUserByUsername, listUsers, updateUser } from "./users.js";

let db: DatabaseSync;
let tempDir: string;
beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-users-"));
  db = openDb(path.join(tempDir, "studium.db"));
  migrate(db);
});
afterEach(async () => {
  db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("users", () => {
  it("creates, reads, and updates users without exposing password hashes", async () => {
    const user = await createUser(db, {
      username: "learner_1",
      password: "password",
      role: "ADMIN",
      email: "Learner@Example.com",
    });
    expect(user).toMatchObject({ username: "learner_1", hasPassword: true, aiEnabled: true });
    expect(user).not.toHaveProperty("password_hash");
    expect(getUserByEmail(db, "learner@example.com")?.id).toBe(user.id);
    expect(getUserByEmail(db, "")).toBeNull();
    expect(updateUser(db, user.id, { displayName: "Learner", aiEnabled: false })).toMatchObject({
      displayName: "Learner",
      aiEnabled: false,
    });
    expect(getUserByUsername(db, "learner_1")?.username).toBe("learner_1");
    expect(listUsers(db)).toHaveLength(1);
    expect(countAdmins(db)).toBe(1);
  });

  it("rejects usernames outside the immutable directory-safe format", async () => {
    await expect(createUser(db, { username: "../admin", role: "ADMIN" })).rejects.toThrow(/username must match/);
    await expect(createUser(db, { username: "A", role: "ADMIN" })).rejects.toThrow(/username must match/);
  });

  it("rejects passwords shorter than 8 characters", async () => {
    await expect(createUser(db, { username: "short", role: "USER", password: "1234567" })).rejects.toThrow(
      /at least 8/,
    );
  });
});
