import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { migrate, openDb } from "../db/db.js";
import {
  BACKUP_SETTING_KEY,
  type BackupDestination,
  defaultBackupSettings,
  destinationSecrets,
  loadBackupSettings,
  mergeDestination,
  parseDestination,
  redactBackupSettings,
  requireDestinationSecrets,
  saveBackupSettings,
} from "./config.js";

const key = Buffer.alloc(32, 3);

let dir: string;
let db: DatabaseSync;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), "studium-backup-config-"));
  db = openDb(path.join(dir, "studium.db"));
  migrate(db);
});

afterEach(async () => {
  db.close();
  await rm(dir, { recursive: true, force: true });
});

function storedJson(): string {
  const row = db.prepare("SELECT value FROM instance_settings WHERE key = ?").get(BACKUP_SETTING_KEY) as {
    value: string;
  };
  return row.value;
}

describe("backup config", () => {
  it("returns defaults when nothing is stored", () => {
    expect(loadBackupSettings(db, key)).toEqual(defaultBackupSettings());
    expect(defaultBackupSettings().schedule).toEqual({ enabled: false, time: "03:30" });
    expect(defaultBackupSettings().retention).toEqual({ daily: 7, weekly: 4, monthly: 12 });
  });

  it("encrypts every secret at rest and decrypts it on load", () => {
    const destination: BackupDestination = {
      type: "s3",
      endpoint: "https://s3.example.com",
      bucket: "studium",
      prefix: "daily",
      accessKeyId: "AKIAEXAMPLE",
      secretAccessKey: "super-secret-key",
      region: "us-east-1",
    };
    saveBackupSettings(db, key, {
      ...defaultBackupSettings(),
      destination,
      repoPassword: "repo-password",
    });

    const raw = storedJson();
    expect(raw).not.toContain("super-secret-key");
    expect(raw).not.toContain("AKIAEXAMPLE");
    expect(raw).not.toContain("repo-password");
    expect(loadBackupSettings(db, key).destination).toEqual(destination);
    expect(loadBackupSettings(db, key).repoPassword).toBe("repo-password");
  });

  it("redacts secrets from the API view while reporting that they are set", () => {
    const destination: BackupDestination = {
      type: "rclone",
      remote: "b2",
      path: "studium",
      rcloneConfig: "[b2]\ntype = b2\naccount = x\nkey = y\n",
    };
    saveBackupSettings(db, key, { ...defaultBackupSettings(), destination, repoPassword: "repo-password" });

    const redacted = redactBackupSettings(loadBackupSettings(db, key));
    expect(redacted.hasRepoPassword).toBe(true);
    expect(redacted.destination).toEqual({ type: "rclone", remote: "b2", path: "studium", hasConfig: true });
    const serialized = JSON.stringify(redacted);
    expect(serialized).not.toContain("repo-password");
    expect(serialized).not.toContain("key = y");
  });

  it("validates destinations", () => {
    expect(() => parseDestination({ type: "local", path: "relative/dir" })).toThrow("must be absolute");
    expect(() => parseDestination({ type: "nope" })).toThrow("destination type");
    expect(() => parseDestination({ type: "sftp", host: "", user: "backup", path: "/srv" })).toThrow(
      "host must be a non-empty string",
    );
    expect(() => parseDestination({ type: "rest", url: "ftp://example.com" })).toThrow("http(s) URL");
    expect(parseDestination({ type: "sftp", host: "host", user: "backup", path: "/srv" })).toEqual({
      type: "sftp",
      host: "host",
      port: 22,
      user: "backup",
      path: "/srv",
    });
  });

  it("requires the credentials a destination cannot run without", () => {
    const s3 = parseDestination({
      type: "s3",
      endpoint: "https://s3.example.com",
      bucket: "studium",
      prefix: "x",
    });
    expect(() => requireDestinationSecrets(s3)).toThrow("s3 destination requires");
    const rclone = parseDestination({ type: "rclone", remote: "b2", path: "" });
    expect(() => requireDestinationSecrets(rclone)).toThrow("rclone destination requires");
    expect(() => requireDestinationSecrets({ type: "local", path: "/tmp/repo" })).not.toThrow();
  });

  it("keeps stored credentials when the client sends blanks", () => {
    const stored: BackupDestination = {
      type: "s3",
      endpoint: "https://s3.example.com",
      bucket: "studium",
      prefix: "x",
      accessKeyId: "AKIA",
      secretAccessKey: "secret",
    };
    const incoming = parseDestination({
      type: "s3",
      endpoint: "https://s3.example.com",
      bucket: "studium",
      prefix: "x",
      accessKeyId: "",
      secretAccessKey: "",
    });
    expect(mergeDestination(incoming, stored)).toEqual(stored);
    expect(mergeDestination(incoming, { type: "local", path: "/tmp/repo" })).toEqual(incoming);
  });

  it("lists the secret values of a destination for redaction", () => {
    const destination = parseDestination({
      type: "rest",
      url: "https://rest.example.com",
      username: "backup",
      password: "rest-password",
    });
    expect(destinationSecrets(destination)).toEqual(["rest-password"]);
    expect(destinationSecrets({ type: "local", path: "/tmp/repo" })).toEqual([]);
  });
});
