import { execFile as execFileCb } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { cp, rm } from "node:fs/promises";
import path from "node:path";
import { type DatabaseSync, backup as sqliteBackup } from "node:sqlite";
import { promisify } from "node:util";
import { commitPaths } from "../tree/git.js";
import type { FileLocks } from "../tree/lock.js";
import { PathError, resolveInRoot } from "../tree/paths.js";
import {
  type BackupCheckRecord,
  type BackupDestination,
  type BackupRunRecord,
  type BackupSchedule,
  type BackupSettings,
  DEFAULT_SCHEDULE,
  loadBackupSettings,
  mergeDestination,
  requireDestinationSecrets,
  saveBackupSettings,
} from "./config.js";
import {
  formatResticFailure,
  isMissingRepository,
  parseSnapshotId,
  redactSecrets,
  repositoryString,
  runRestic,
  secretsFor,
  sftpKeyPath,
  stagingDbPath,
} from "./restic.js";

const execFile = promisify(execFileCb);

const PROBE_TIMEOUT_MS = 60_000;
const INIT_TIMEOUT_MS = 120_000;
const BACKUP_TIMEOUT_MS = 60 * 60_000;
const RESTORE_TIMEOUT_MS = 30 * 60_000;
const CHECK_TIMEOUT_MS = 60 * 60_000;

export const SNAPSHOT_ID_PATTERN = /^[0-9a-f]{8,64}$/;

export interface BackupServiceDeps {
  db: DatabaseSync;
  dataDir: string;
  key: Buffer;
  treeFor(username: string): Promise<{ root: string; locks: FileLocks }> | { root: string; locks: FileLocks };
  /** T5 notifier; a no-op until it exists. */
  notifyAdmins?(title: string, body: string): void | Promise<void>;
  log?(message: string): void;
}

export interface BackupStatus {
  running: boolean;
  phase: string | null;
  startedAt: string | null;
  lastRun: BackupRunRecord | null;
}

export interface SnapshotInfo {
  id: string;
  shortId: string;
  time: string;
  paths: string[];
  sizeBytes?: number;
}

export interface RecoveryKit {
  repository: string;
  password: string;
  restoreSteps: string[];
}

export interface ProbeResult {
  ok: boolean;
  state: "empty" | "existing" | "error";
  message: string;
}

export interface RestoreInput {
  snapshotId: string;
  username: string;
  path: string;
}

export interface RestoreResult {
  path: string;
  commitSha: string | null;
}

/** Thrown when another restic operation already holds the run mutex. */
export class BackupBusyError extends Error {
  constructor(phase: string) {
    super(`a backup ${phase} is already running`);
    this.name = "BackupBusyError";
  }
}

/** Thrown when no destination/repository password has been configured yet. */
export class BackupNotConfiguredError extends Error {
  constructor() {
    super("backups are not configured yet");
    this.name = "BackupNotConfiguredError";
  }
}

function restoreSteps(repository: string): string[] {
  return [
    `Set RESTIC_REPOSITORY=${repository} and RESTIC_PASSWORD=<the password above>.`,
    "Run `restic snapshots` to list snapshots.",
    "Run `restic restore latest --target /tmp/studium-restore` to restore a whole instance.",
    "Store this repository URL and password somewhere safe: the password is shown only once.",
    "Loss of the password means the backups are irrecoverable.",
  ];
}

function requireConfigured(settings: BackupSettings): { destination: BackupDestination; password: string } {
  if (settings.destination === null || settings.repoPassword === null || settings.repoPassword === "") {
    throw new BackupNotConfiguredError();
  }
  return { destination: settings.destination, password: settings.repoPassword };
}

/**
 * Owns the single restic run slot and the backup lifecycle: probe, init, run,
 * check, list and restore. Exactly one operation runs at a time.
 */
export class BackupService {
  readonly #db: DatabaseSync;
  readonly #dataDir: string;
  readonly #key: Buffer;
  readonly #treeFor: BackupServiceDeps["treeFor"];
  readonly #notifyAdmins: (title: string, body: string) => void | Promise<void>;
  readonly #log: (message: string) => void;
  readonly #configListeners = new Set<() => void>();
  #current: { phase: string; startedAt: string } | null = null;

  constructor(deps: BackupServiceDeps) {
    this.#db = deps.db;
    this.#dataDir = deps.dataDir;
    this.#key = deps.key;
    this.#treeFor = deps.treeFor;
    this.#notifyAdmins = deps.notifyAdmins ?? (() => undefined);
    this.#log = deps.log ?? (() => undefined);
  }

  settings(): BackupSettings {
    return loadBackupSettings(this.#db, this.#key);
  }

  status(): BackupStatus {
    return {
      running: this.#current !== null,
      phase: this.#current?.phase ?? null,
      startedAt: this.#current?.startedAt ?? null,
      lastRun: this.settings().lastRun,
    };
  }

  onConfigChange(listener: () => void): () => void {
    this.#configListeners.add(listener);
    return () => this.#configListeners.delete(listener);
  }

  notifyConfigChange(): void {
    for (const listener of this.#configListeners) listener();
  }

  async #exclusive<T>(phase: string, operation: () => Promise<T>): Promise<T> {
    if (this.#current !== null) throw new BackupBusyError(this.#current.phase);
    this.#current = { phase, startedAt: new Date().toISOString() };
    try {
      return await operation();
    } finally {
      this.#current = null;
    }
  }

  async #probe(destination: BackupDestination, password: string): Promise<ProbeResult> {
    const result = await runRestic(["cat", "config"], destination, password, {
      dataDir: this.#dataDir,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (result.code === 0) return { ok: true, state: "existing", message: "repository found" };
    const text = [result.stderr, result.stdout]
      .filter((value) => value.trim() !== "")
      .join("\n")
      .trim();
    if (isMissingRepository(text)) return { ok: true, state: "empty", message: "no repository yet" };
    if (destination.type === "local" && existsSync(path.join(destination.path, "config"))) {
      return { ok: true, state: "existing", message: "repository found; a password is required to open it" };
    }
    return {
      ok: false,
      state: "error",
      message: redactSecrets(text || "restic failed", secretsFor(destination, password)),
    };
  }

  async test(destination: BackupDestination): Promise<ProbeResult> {
    const stored = this.settings();
    const merged = mergeDestination(destination, stored.destination);
    requireDestinationSecrets(merged);
    return await this.#exclusive("test", () => this.#probe(merged, stored.repoPassword ?? ""));
  }

  async init(destination: BackupDestination, existingPassword?: string): Promise<RecoveryKit> {
    return await this.#exclusive("init", async () => {
      const stored = this.settings();
      const merged = mergeDestination(destination, stored.destination);
      requireDestinationSecrets(merged);
      const supplied = existingPassword ?? "";
      if (supplied !== "") {
        const verified = await runRestic(["cat", "config"], merged, supplied, {
          dataDir: this.#dataDir,
          timeoutMs: PROBE_TIMEOUT_MS,
        });
        if (verified.code !== 0) {
          throw new Error(
            `could not open the existing repository: ${formatResticFailure(verified, secretsFor(merged, supplied))}`,
          );
        }
        this.#save(merged, supplied);
        return this.#recoveryKit(merged, supplied);
      }
      const probe = await this.#probe(merged, stored.repoPassword ?? "");
      if (probe.state === "error") throw new Error(probe.message);
      if (probe.state === "existing") {
        throw new Error("a repository already exists at this destination; provide existingPassword");
      }
      const password = randomBytes(32).toString("base64url");
      const created = await runRestic(["init"], merged, password, {
        dataDir: this.#dataDir,
        timeoutMs: INIT_TIMEOUT_MS,
      });
      if (created.code !== 0) throw new Error(formatResticFailure(created, secretsFor(merged, password)));
      this.#save(merged, password);
      return this.#recoveryKit(merged, password);
    });
  }

  #save(destination: BackupDestination, repoPassword: string): void {
    const settings = this.settings();
    saveBackupSettings(this.#db, this.#key, { ...settings, destination, repoPassword });
  }

  #recoveryKit(destination: BackupDestination, password: string): RecoveryKit {
    const repository = repositoryString(destination);
    return { repository, password, restoreSteps: restoreSteps(repository) };
  }

  /** Run a backup now. Failures are recorded and reported, not thrown. */
  async runBackup(): Promise<BackupRunRecord> {
    return await this.#exclusive("backup", async () => {
      const settings = this.settings();
      const { destination, password } = requireConfigured(settings);
      const secrets = secretsFor(destination, password);
      let record: BackupRunRecord;
      try {
        mkdirSync(path.dirname(stagingDbPath(this.#dataDir)), { recursive: true, mode: 0o700 });
        await sqliteBackup(this.#db, stagingDbPath(this.#dataDir));
        const backupResult = await runRestic(
          [
            "backup",
            this.#dataDir,
            "--exclude",
            `${path.join(this.#dataDir, "studium.db")}*`,
            "--exclude",
            `${path.join(this.#dataDir, ".backup", "restore")}-*`,
            "--exclude",
            "**/.cache",
            "--tag",
            "studium",
          ],
          destination,
          password,
          { dataDir: this.#dataDir, timeoutMs: BACKUP_TIMEOUT_MS },
        );
        if (backupResult.code !== 0) {
          throw new Error(formatResticFailure(backupResult, secrets));
        }
        const snapshotId = parseSnapshotId(backupResult.stdout) ?? undefined;
        const forgetResult = await runRestic(
          [
            "forget",
            "--prune",
            "--keep-daily",
            String(settings.retention.daily),
            "--keep-weekly",
            String(settings.retention.weekly),
            "--keep-monthly",
            String(settings.retention.monthly),
          ],
          destination,
          password,
          { dataDir: this.#dataDir, timeoutMs: BACKUP_TIMEOUT_MS },
        );
        if (forgetResult.code !== 0) {
          throw new Error(`backup succeeded but pruning failed: ${formatResticFailure(forgetResult, secrets)}`);
        }
        record = {
          at: new Date().toISOString(),
          ok: true,
          message: "backup completed",
          ...(snapshotId === undefined ? {} : { snapshotId }),
        };
      } catch (error) {
        record = {
          at: new Date().toISOString(),
          ok: false,
          message: redactSecrets(error instanceof Error ? error.message : "backup failed", secrets),
        };
      }
      this.#recordRun(record);
      if (!record.ok) {
        this.#log(`backup failed: ${record.message}`);
        await Promise.resolve(this.#notifyAdmins("backup failed", record.message)).catch(() => undefined);
      }
      return record;
    });
  }

  async runCheck(): Promise<BackupCheckRecord> {
    return await this.#exclusive("check", async () => {
      const settings = this.settings();
      const { destination, password } = requireConfigured(settings);
      const secrets = secretsFor(destination, password);
      let record: BackupCheckRecord;
      try {
        const result = await runRestic(["check", "--read-data-subset=5%"], destination, password, {
          dataDir: this.#dataDir,
          timeoutMs: CHECK_TIMEOUT_MS,
        });
        if (result.code !== 0) throw new Error(formatResticFailure(result, secrets));
        record = { at: new Date().toISOString(), ok: true, message: "repository check passed" };
      } catch (error) {
        record = {
          at: new Date().toISOString(),
          ok: false,
          message: redactSecrets(error instanceof Error ? error.message : "check failed", secrets),
        };
      }
      this.#recordCheck(record);
      return record;
    });
  }

  async snapshots(): Promise<SnapshotInfo[]> {
    const { destination, password } = requireConfigured(this.settings());
    const result = await runRestic(["snapshots"], destination, password, {
      dataDir: this.#dataDir,
      timeoutMs: PROBE_TIMEOUT_MS,
    });
    if (result.code !== 0) {
      if (isMissingRepository(`${result.stderr}\n${result.stdout}`)) return [];
      throw new Error(formatResticFailure(result, secretsFor(destination, password)));
    }
    const text = result.stdout.trim();
    if (text === "") return [];
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error("could not parse the restic snapshot list");
    }
    if (!Array.isArray(parsed)) return [];
    return parsed.map((entry) => {
      const snapshot = entry as {
        id?: unknown;
        short_id?: unknown;
        time?: unknown;
        paths?: unknown;
        summary?: { total_bytes_processed?: unknown };
      };
      const id = typeof snapshot.id === "string" ? snapshot.id : "";
      const info: SnapshotInfo = {
        id,
        shortId: typeof snapshot.short_id === "string" ? snapshot.short_id : id.slice(0, 8),
        time: typeof snapshot.time === "string" ? snapshot.time : "",
        paths: Array.isArray(snapshot.paths) ? snapshot.paths.filter((p): p is string => typeof p === "string") : [],
      };
      const size = snapshot.summary?.total_bytes_processed;
      if (typeof size === "number") info.sizeBytes = size;
      return info;
    });
  }

  async restore(input: RestoreInput): Promise<RestoreResult> {
    return await this.#exclusive("restore", async () => {
      if (!SNAPSHOT_ID_PATTERN.test(input.snapshotId)) throw new Error("invalid snapshot id");
      const { destination, password } = requireConfigured(this.settings());
      const secrets = secretsFor(destination, password);
      const scope = path.posix.normalize(input.path.replaceAll("\\", "/")).replace(/^\/+|\/+$/g, "");
      if (scope === "" || scope === "." || scope === ".git" || scope.startsWith(".git/")) {
        throw new Error("invalid restore scope: pick a set or a note, not the whole tree or .git");
      }
      const tree = await this.#treeFor(input.username);
      let absolute: string;
      try {
        absolute = resolveInRoot(tree.root, input.path);
      } catch (error) {
        if (error instanceof PathError) throw new Error(`invalid restore scope: ${error.message}`);
        throw error;
      }
      const staging = path.join(this.#dataDir, ".backup", `restore-${Date.now()}`);
      mkdirSync(staging, { recursive: true, mode: 0o700 });
      try {
        const resticRestore = await runRestic(
          ["restore", input.snapshotId, "--target", staging, "--include", absolute],
          destination,
          password,
          { dataDir: this.#dataDir, timeoutMs: RESTORE_TIMEOUT_MS },
        );
        if (resticRestore.code !== 0) throw new Error(formatResticFailure(resticRestore, secrets));
        const restored = path.join(staging, absolute);
        if (!existsSync(restored)) throw new Error(`snapshot does not contain ${input.path}`);
        const short = input.snapshotId.slice(0, 8);
        const message = `system: restore ${input.path} from snapshot ${short}`;
        const commitSha = await tree.locks.withLock(input.path, "system", async () => {
          await cp(restored, absolute, { recursive: true, force: true });
          return await commitPaths(tree.root, [input.path], message, "system");
        });
        return { path: input.path, commitSha };
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    });
  }

  /** Generate the ed25519 key used for sftp destinations. Idempotent. */
  async ensureSftpKey(): Promise<{ publicKey: string }> {
    const keyPath = sftpKeyPath(this.#dataDir);
    mkdirSync(path.dirname(keyPath), { recursive: true, mode: 0o700 });
    if (!existsSync(keyPath)) {
      await execFile("ssh-keygen", ["-t", "ed25519", "-N", "", "-f", keyPath]);
    }
    return { publicKey: readFileSync(`${keyPath}.pub`, "utf8").trim() };
  }

  #recordRun(record: BackupRunRecord): void {
    const settings = this.settings();
    saveBackupSettings(this.#db, this.#key, { ...settings, lastRun: record });
  }

  #recordCheck(record: BackupCheckRecord): void {
    const settings = this.settings();
    saveBackupSettings(this.#db, this.#key, { ...settings, lastCheck: record });
  }
}

/** Milliseconds until the next `HH:MM` local wall-clock time. */
export function nextRunDelay(now: Date, time: string): number {
  const match = /^(\d{2}):(\d{2})$/.exec(time);
  if (match === null) return nextRunDelay(now, "03:30");
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return nextRunDelay(now, "03:30");
  const target = new Date(now);
  target.setHours(hours, minutes, 0, 0);
  if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
  return target.getTime() - now.getTime();
}

/** The monthly integrity check runs after the backup on the 1st. */
export function isMonthlyCheckDay(now: Date): boolean {
  return now.getDate() === 1;
}

export interface BackupSchedulerDeps {
  service: BackupService;
  now?: () => Date;
  onError?(error: unknown): void;
}

/** Fires the daily backup at the configured local time, and stops on shutdown. */
export class BackupScheduler {
  readonly #service: BackupService;
  readonly #now: () => Date;
  readonly #onError: (error: unknown) => void;
  #timer: NodeJS.Timeout | null = null;
  #started = false;

  constructor(deps: BackupSchedulerDeps) {
    this.#service = deps.service;
    this.#now = deps.now ?? (() => new Date());
    this.#onError = deps.onError ?? (() => undefined);
  }

  start(): void {
    if (this.#started) return;
    this.#started = true;
    this.#service.onConfigChange(() => this.#rearm());
    this.#arm();
  }

  stop(): void {
    this.#started = false;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#timer = null;
  }

  #rearm(): void {
    if (!this.#started) return;
    if (this.#timer !== null) clearTimeout(this.#timer);
    this.#arm();
  }

  #arm(): void {
    if (!this.#started) return;
    let schedule: BackupSchedule = DEFAULT_SCHEDULE;
    try {
      schedule = this.#service.settings().schedule;
    } catch (error) {
      // A corrupt configuration must not take the whole scheduler down.
      this.#onError(error);
    }
    const delay = nextRunDelay(this.#now(), schedule.time);
    const timer = setTimeout(() => {
      this.#tick();
    }, delay);
    timer.unref?.();
    this.#timer = timer;
  }

  #tick(): void {
    if (!this.#started) return;
    const now = this.#now();
    void this.#runOnce(now);
    this.#arm();
  }

  async #runOnce(now: Date): Promise<void> {
    try {
      if (!this.#service.settings().schedule.enabled) return;
      const result = await this.#service.runBackup();
      if (!result.ok) this.#onError(new Error(result.message));
      if (result.ok && isMonthlyCheckDay(now)) await this.#service.runCheck();
    } catch (error) {
      this.#onError(error);
    }
  }
}
