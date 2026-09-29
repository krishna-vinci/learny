import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashPassword } from "../auth/password.js";
import { migrate, openDb } from "../db/db.js";
import { bootstrapAccounts } from "./bootstrap.js";
import { listUsers, verifyUserPassword } from "./users.js";

let db: DatabaseSync;
let tempDir: string;
beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-bootstrap-"));
  db = openDb(path.join(tempDir, "studium.db"));
  migrate(db);
});
afterEach(async () => {
  db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("account bootstrap", () => {
  it("reports setup required without a legacy login", async () => {
    await expect(bootstrapAccounts(db, {})).resolves.toEqual({ setupRequired: true });
  });

  it("migrates the legacy environment login once", async () => {
    const hash = await hashPassword("study-password");
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);
    await expect(
      bootstrapAccounts(db, { STUDIUM_USERNAME: "Admin_User", STUDIUM_PASSWORD_HASH: hash }),
    ).resolves.toEqual({ setupRequired: false });
    const [user] = listUsers(db);
    expect(user).toMatchObject({ username: "admin_user", role: "ADMIN", hasPassword: true });
    expect(await verifyUserPassword(db, user?.id ?? 0, "study-password")).toBe(true);
    expect(log).toHaveBeenCalledWith("migrated legacy .env login to admin admin_user");
    log.mockRestore();
  });
});
