import { spawnSync } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSession } from "../accounts/sessions.js";
import { createUser } from "../accounts/users.js";
import { migrate, openDb } from "../db/db.js";
import { createServer } from "../server.js";
import { commitAll, ensureRepo, log } from "../tree/git.js";
import { initStudyTree } from "../tree/init.js";
import { FileLocks } from "../tree/lock.js";
import { BACKUP_SETTING_KEY } from "./config.js";
import { BackupService } from "./scheduler.js";

const resticAvailable = spawnSync("restic", ["version"]).status === 0;
if (!resticAvailable) {
  console.warn("backup tests skipped: restic is not installed (expected at /usr/bin/restic)");
}

const key = Buffer.alloc(32, 11);
const NOTE_PATH = "sample/notes/intro.md";

let dataDir: string;
let treeRoot: string;
let db: DatabaseSync;
let app: Hono;
let token: string;
let locks: FileLocks;
let service: BackupService;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-backups-"));
  treeRoot = path.join(dataDir, "users", "learner");
  await fs.mkdir(path.join(treeRoot, "sample", "notes"), { recursive: true });
  await fs.writeFile(path.join(treeRoot, NOTE_PATH), "intro\n");
  await initStudyTree(treeRoot);
  await ensureRepo(treeRoot);

  db = openDb(path.join(dataDir, "studium.db"));
  migrate(db);
  const admin = await createUser(db, { username: "admin", password: "admin-pass", role: "ADMIN" });
  token = createSession(db, admin.id, { userAgent: "test", ip: "" }).token;
  locks = new FileLocks();
  service = new BackupService({ db, dataDir, key, treeFor: () => ({ root: treeRoot, locks }) });
  app = createServer({
    db,
    instanceSecret: Buffer.alloc(32, 1),
    workspaces: {
      for: async () => ({ app: new Hono() }),
      provision: async () => undefined,
      stop: async () => undefined,
      rootFor: () => null,
    },
    authOpts: { trustProxy: false, baseUrl: null, setupCode: null },
    backups: { service, db, key },
  });
});

afterEach(async () => {
  db.close();
  await fs.rm(dataDir, { recursive: true, force: true });
});

async function request(method: string, url: string, body?: unknown): Promise<Response> {
  return await app.request(url, {
    method,
    headers: { cookie: `studium_session=${token}`, "content-type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function repositoryPath(): string {
  return path.join(dataDir, "repo");
}

function localDestination(): { type: "local"; path: string } {
  return { type: "local", path: repositoryPath() };
}

async function initRepository(): Promise<{ password: string; repository: string; restoreSteps: string[] }> {
  const response = await request("POST", "/api/admin/backups/init", { destination: localDestination() });
  expect(response.status).toBe(200);
  const { recoveryKit } = (await response.json()) as {
    recoveryKit: { password: string; repository: string; restoreSteps: string[] };
  };
  return recoveryKit;
}

async function backupNow(): Promise<void> {
  const response = await request("POST", "/api/admin/backups/run", {});
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ ok: true });
}

describe("backup admin routes", () => {
  it("is mounted behind admin auth", async () => {
    const anonymous = await app.request("/api/admin/backups");
    expect(anonymous.status).toBe(401);

    const learner = await createUser(db, { username: "learner", password: "learner-pass", role: "USER" });
    const learnerToken = createSession(db, learner.id, { userAgent: "test", ip: "" }).token;
    const response = await app.request("/api/admin/backups", {
      headers: { cookie: `studium_session=${learnerToken}` },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "forbidden" });
  });
});

describe.skipIf(!resticAvailable)("backup routes against a real restic repository", { timeout: 60_000 }, () => {
  it("tests an empty destination, initialises it, backs up, and lists the snapshot", async () => {
    const probe = await request("POST", "/api/admin/backups/test", { destination: localDestination() });
    expect(await probe.json()).toMatchObject({ ok: true, state: "empty" });

    const recoveryKit = await initRepository();
    expect(recoveryKit.repository).toBe(repositoryPath());
    expect(recoveryKit.password).toMatch(/^[A-Za-z0-9_-]{20,}$/);
    expect(recoveryKit.restoreSteps.join("\n")).toContain("restic restore");

    const response = await request("GET", "/api/admin/backups");
    const { config, resticVersion } = (await response.json()) as {
      config: { destination: unknown; hasRepoPassword: boolean };
      resticVersion: string;
    };
    expect(config.destination).toEqual({ type: "local", path: repositoryPath() });
    expect(config.hasRepoPassword).toBe(true);
    expect(resticVersion).toMatch(/^restic /);
    // The password is shown once, at init, and never again.
    expect(JSON.stringify({ config, resticVersion })).not.toContain(recoveryKit.password);
    const stored = db.prepare("SELECT value FROM instance_settings WHERE key = ?").get(BACKUP_SETTING_KEY) as {
      value: string;
    };
    expect(stored.value).not.toContain(recoveryKit.password);

    const schedule = await request("PATCH", "/api/admin/backups", {
      schedule: { enabled: true, time: "04:15" },
      retention: { daily: 3, weekly: 2, monthly: 1 },
    });
    expect(schedule.status).toBe(200);
    expect(await schedule.json()).toMatchObject({
      config: { schedule: { enabled: true, time: "04:15" }, retention: { daily: 3, weekly: 2, monthly: 1 } },
    });

    await backupNow();
    const snapshots = (await (await request("GET", "/api/admin/backups/snapshots")).json()) as {
      snapshots: Array<{ id: string; shortId: string; paths: string[] }>;
    };
    expect(snapshots.snapshots).toHaveLength(1);
    expect(snapshots.snapshots[0]?.paths).toEqual([dataDir]);
    expect(snapshots.snapshots[0]?.id).toMatch(/^[0-9a-f]{64}$/);

    const status = (await (await request("GET", "/api/admin/backups/status")).json()) as {
      running: boolean;
      lastRun: { ok: boolean; snapshotId?: string };
    };
    expect(status.running).toBe(false);
    expect(status.lastRun).toMatchObject({ ok: true });
    // restic 0.14 reports only the short id in the backup summary.
    expect(status.lastRun.snapshotId).toMatch(/^[0-9a-f]{8,64}$/);
  });

  it("restores a deleted note and commits it", async () => {
    await initRepository();
    await backupNow();
    const snapshots = (await (await request("GET", "/api/admin/backups/snapshots")).json()) as {
      snapshots: Array<{ id: string }>;
    };
    const snapshotId = snapshots.snapshots[0]?.id ?? "";

    // The deletion is committed, as a user edit would be.
    await fs.rm(path.join(treeRoot, NOTE_PATH));
    await commitAll(treeRoot, "user: delete note", "user");
    expect(existsSync(path.join(treeRoot, NOTE_PATH))).toBe(false);

    const response = await request("POST", "/api/admin/backups/restore", {
      snapshotId,
      scope: { type: "note", username: "learner", path: NOTE_PATH },
    });
    expect(response.status).toBe(200);
    const result = (await response.json()) as { path: string; commitSha: string | null };
    expect(result.path).toBe(NOTE_PATH);
    expect(result.commitSha).toMatch(/^[0-9a-f]{40}$/);
    expect(await fs.readFile(path.join(treeRoot, NOTE_PATH), "utf8")).toBe("intro\n");

    const commits = await log(treeRoot);
    expect(commits[0]?.subject).toBe(`system: restore ${NOTE_PATH} from snapshot ${snapshotId.slice(0, 8)}`);
    expect(commits[0]?.sha).toBe(result.commitSha);

    // The staging directory is cleaned up.
    const leftovers = (await fs.readdir(path.join(dataDir, ".backup"))).filter((name) => name.startsWith("restore-"));
    expect(leftovers).toEqual([]);
  });

  it("confines the restore scope inside the user's tree", async () => {
    await initRepository();
    await backupNow();
    const snapshots = (await (await request("GET", "/api/admin/backups/snapshots")).json()) as {
      snapshots: Array<{ id: string }>;
    };
    const snapshotId = snapshots.snapshots[0]?.id ?? "";

    for (const scopePath of ["../escape.md", "/etc/passwd", "sample/../../escape.md"]) {
      const response = await request("POST", "/api/admin/backups/restore", {
        snapshotId,
        scope: { type: "note", username: "learner", path: scopePath },
      });
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: string }).error).toContain("invalid restore scope");
    }
  });

  it("verifies an existing repository password instead of re-initialising", async () => {
    const recoveryKit = await initRepository();

    const withoutPassword = await request("POST", "/api/admin/backups/init", { destination: localDestination() });
    expect(withoutPassword.status).toBe(400);
    expect(((await withoutPassword.json()) as { error: string }).error).toContain("already exists");

    const wrong = await request("POST", "/api/admin/backups/init", {
      destination: localDestination(),
      existingPassword: "definitely-not-the-password",
    });
    expect(wrong.status).toBe(400);
    const wrongBody = (await wrong.json()) as { error: string };
    expect(wrongBody.error).toContain("could not open the existing repository");
    expect(JSON.stringify(wrongBody)).not.toContain("definitely-not-the-password");

    const correct = await request("POST", "/api/admin/backups/init", {
      destination: localDestination(),
      existingPassword: recoveryKit.password,
    });
    expect(correct.status).toBe(200);
    expect(JSON.stringify(await correct.json())).not.toContain("definitely-not-the-password");
  });

  it("reports status and never exposes the password through the API", async () => {
    const recoveryKit = await initRepository();
    const status = await request("GET", "/api/admin/backups/status");
    expect(await status.json()).toMatchObject({ running: false, phase: null });
    for (const url of ["/api/admin/backups", "/api/admin/backups/status", "/api/admin/backups/snapshots"]) {
      const response = await request("GET", url);
      expect(JSON.stringify(await response.json())).not.toContain(recoveryKit.password);
    }
  });

  it("rejects a backup that has not been configured", async () => {
    const response = await request("POST", "/api/admin/backups/run", {});
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toContain("not configured");
  });

  it("runs only one backup at a time", async () => {
    await initRepository();
    const first = service.runBackup();
    await expect(service.runBackup()).rejects.toThrow("already running");
    expect(await first).toMatchObject({ ok: true });
  });
});

const sshKeygenAvailable = spawnSync("ssh-keygen", ["-h"]).status !== 127;
describe.skipIf(!sshKeygenAvailable)("sftp key", () => {
  it("generates an ed25519 key once and is idempotent", async () => {
    const first = (await (await request("POST", "/api/admin/backups/sftp-key")).json()) as { publicKey: string };
    expect(first.publicKey).toMatch(/^ssh-ed25519 /);
    const second = (await (await request("POST", "/api/admin/backups/sftp-key")).json()) as { publicKey: string };
    expect(second.publicKey).toBe(first.publicKey);
    expect((await fs.stat(path.join(dataDir, ".backup", "id_ed25519"))).mode & 0o777).toBe(0o600);
  });
});
