import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb } from "../db/db.js";
import { getInstanceSettings, updateInstanceSettings } from "./settings.js";

let db: DatabaseSync;
let tempDir: string;
beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-settings-"));
  db = openDb(path.join(tempDir, "studium.db"));
  migrate(db);
});
afterEach(async () => {
  db.close();
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe("instance settings", () => {
  it("uses defaults and updates individual values", () => {
    expect(getInstanceSettings(db)).toEqual({ disallowPasswordAuth: false, instanceUrl: "" });
    expect(updateInstanceSettings(db, { disallowPasswordAuth: true })).toEqual({
      disallowPasswordAuth: true,
      instanceUrl: "",
    });
  });
});
