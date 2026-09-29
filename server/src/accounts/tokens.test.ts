import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb } from "../db/db.js";
import { createAccessToken, deleteAccessToken, listAccessTokens, resolveAccessToken } from "./tokens.js";
import { createUser } from "./users.js";

let db: DatabaseSync;
let tempDir: string;
beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-tokens-"));
  db = openDb(path.join(tempDir, "studium.db"));
  migrate(db);
});
afterEach(async () => {
  db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("personal access tokens", () => {
  it("creates, resolves, lists without secrets, and deletes a PAT", async () => {
    const user = await createUser(db, { username: "learner", role: "USER" });
    const created = createAccessToken(db, user.id, { description: "script" });
    expect(created.token).toMatch(/^studium_pat_/);
    expect(resolveAccessToken(db, created.token)?.user.id).toBe(user.id);
    const listed = listAccessTokens(db, user.id);
    expect(listed).toHaveLength(1);
    expect(listed[0]).not.toHaveProperty("token");
    expect(listed[0]).not.toHaveProperty("tokenHash");
    expect(deleteAccessToken(db, user.id, created.id)).toBe(true);
    expect(resolveAccessToken(db, created.token)).toBeNull();
  });
});
