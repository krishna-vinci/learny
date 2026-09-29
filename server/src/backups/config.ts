import { isIP } from "node:net";
import type { DatabaseSync } from "node:sqlite";
import { decryptSecret, encryptSecret } from "../db/crypto.js";
import { deriveKey } from "../db/secret.js";

/** instance_settings key holding the backup configuration (JSON). */
export const BACKUP_SETTING_KEY = "backup";
export const SECRETS_KEY_LABEL = "studium-secrets-v1";

export type BackupDestination =
  | { type: "local"; path: string }
  | { type: "sftp"; host: string; port: number; user: string; path: string }
  | { type: "rest"; url: string; username?: string; password?: string }
  | {
      type: "s3";
      endpoint: string;
      bucket: string;
      prefix: string;
      accessKeyId: string;
      secretAccessKey: string;
      region?: string;
    }
  | { type: "rclone"; remote: string; path: string; rcloneConfig: string };

export interface BackupSchedule {
  enabled: boolean;
  /** Local wall-clock time, "HH:MM". */
  time: string;
}

export interface BackupRetention {
  daily: number;
  weekly: number;
  monthly: number;
}

export interface BackupRunRecord {
  at: string;
  ok: boolean;
  message: string;
  snapshotId?: string;
}

export interface BackupCheckRecord {
  at: string;
  ok: boolean;
  message: string;
}

/** In-memory shape: destination and repoPassword are decrypted. */
export interface BackupSettings {
  destination: BackupDestination | null;
  repoPassword: string | null;
  schedule: BackupSchedule;
  retention: BackupRetention;
  lastRun: BackupRunRecord | null;
  lastCheck: BackupCheckRecord | null;
}

export type RedactedDestination =
  | { type: "local"; path: string }
  | { type: "sftp"; host: string; port: number; user: string; path: string }
  | { type: "rest"; url: string; username?: string; hasPassword: boolean }
  | { type: "s3"; endpoint: string; bucket: string; prefix: string; region?: string; hasKeys: boolean }
  | { type: "rclone"; remote: string; path: string; hasConfig: boolean };

export interface RedactedBackupConfig {
  destination: RedactedDestination | null;
  hasRepoPassword: boolean;
  schedule: BackupSchedule;
  retention: BackupRetention;
  lastRun: BackupRunRecord | null;
  lastCheck: BackupCheckRecord | null;
}

export const DEFAULT_SCHEDULE: BackupSchedule = { enabled: false, time: "03:30" };
export const DEFAULT_RETENTION: BackupRetention = { daily: 7, weekly: 4, monthly: 12 };

/** Key for the encrypted secrets stored in the backup configuration. */
export function deriveBackupKey(instanceSecret: Buffer): Buffer {
  return deriveKey(instanceSecret, SECRETS_KEY_LABEL);
}

export function defaultBackupSettings(): BackupSettings {
  return {
    destination: null,
    repoPassword: null,
    schedule: { ...DEFAULT_SCHEDULE },
    retention: { ...DEFAULT_RETENTION },
    lastRun: null,
    lastCheck: null,
  };
}

/** Destination fields that are encrypted at rest, per destination type. */
const SECRET_FIELDS: Record<string, string[]> = {
  rest: ["password"],
  s3: ["accessKeyId", "secretAccessKey"],
  rclone: ["rcloneConfig"],
};

export function secretFieldsOf(type: string): string[] {
  return SECRET_FIELDS[type] ?? [];
}

/** Every secret value in a destination, for redacting error output. */
export function destinationSecrets(destination: BackupDestination | null): string[] {
  if (destination === null) return [];
  const values: string[] = [];
  if (destination.type === "rest") {
    values.push(destination.url);
    if (destination.username !== undefined && destination.username !== "") values.push(destination.username);
  }
  for (const field of secretFieldsOf(destination.type)) {
    const value = (destination as unknown as Record<string, unknown>)[field];
    if (typeof value === "string" && value !== "") values.push(value);
  }
  return values;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function encodeDestination(destination: BackupDestination, key: Buffer): Record<string, unknown> {
  const stored: Record<string, unknown> = { ...destination };
  for (const field of secretFieldsOf(destination.type)) {
    const value = stored[field];
    if (typeof value === "string" && value !== "") stored[field] = encryptSecret(key, value);
  }
  return stored;
}

function decodeDestination(raw: unknown, key: Buffer): BackupDestination | null {
  if (!isRecord(raw) || typeof raw.type !== "string") return null;
  const decoded: Record<string, unknown> = { ...raw };
  for (const field of secretFieldsOf(raw.type)) {
    const value = decoded[field];
    if (typeof value === "string" && value !== "") decoded[field] = decryptSecret(key, value);
  }
  return decoded as unknown as BackupDestination;
}

function readSetting(db: DatabaseSync): string | null {
  const row = db.prepare("SELECT value FROM instance_settings WHERE key = ?").get(BACKUP_SETTING_KEY) as
    | { value: string }
    | undefined;
  return row === undefined ? null : row.value;
}

function writeSetting(db: DatabaseSync, value: string): void {
  db.prepare(
    "INSERT INTO instance_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  ).run(BACKUP_SETTING_KEY, value);
}

function asSchedule(raw: unknown): BackupSchedule {
  if (!isRecord(raw)) return { ...DEFAULT_SCHEDULE };
  const time = typeof raw.time === "string" && /^\d{2}:\d{2}$/.test(raw.time) ? raw.time : DEFAULT_SCHEDULE.time;
  return { enabled: raw.enabled === true, time };
}

function asRetention(raw: unknown): BackupRetention {
  if (!isRecord(raw)) return { ...DEFAULT_RETENTION };
  const count = (value: unknown, fallback: number): number =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : fallback;
  return {
    daily: count(raw.daily, DEFAULT_RETENTION.daily),
    weekly: count(raw.weekly, DEFAULT_RETENTION.weekly),
    monthly: count(raw.monthly, DEFAULT_RETENTION.monthly),
  };
}

function asRunRecord(raw: unknown): BackupRunRecord | null {
  if (!isRecord(raw) || typeof raw.at !== "string" || typeof raw.ok !== "boolean") return null;
  const record: BackupRunRecord = {
    at: raw.at,
    ok: raw.ok,
    message: typeof raw.message === "string" ? raw.message : "",
  };
  if (typeof raw.snapshotId === "string") record.snapshotId = raw.snapshotId;
  return record;
}

function asCheckRecord(raw: unknown): BackupCheckRecord | null {
  if (!isRecord(raw) || typeof raw.at !== "string" || typeof raw.ok !== "boolean") return null;
  return { at: raw.at, ok: raw.ok, message: typeof raw.message === "string" ? raw.message : "" };
}

/** Load and decrypt the backup settings; returns defaults when nothing is stored. */
export function loadBackupSettings(db: DatabaseSync, key: Buffer): BackupSettings {
  const raw = readSetting(db);
  if (raw === null) return defaultBackupSettings();
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("stored backup configuration is not valid JSON");
  }
  if (!isRecord(parsed)) throw new Error("stored backup configuration is invalid");
  const repoPasswordEnc = typeof parsed.repoPasswordEnc === "string" ? parsed.repoPasswordEnc : null;
  const destination =
    parsed.destination === null || parsed.destination === undefined ? null : decodeDestination(parsed.destination, key);
  return {
    destination,
    repoPassword: repoPasswordEnc === null ? null : decryptSecret(key, repoPasswordEnc),
    schedule: asSchedule(parsed.schedule),
    retention: asRetention(parsed.retention),
    lastRun: asRunRecord(parsed.lastRun),
    lastCheck: asCheckRecord(parsed.lastCheck),
  };
}

export function saveBackupSettings(db: DatabaseSync, key: Buffer, settings: BackupSettings): void {
  const stored = {
    destination: settings.destination === null ? null : encodeDestination(settings.destination, key),
    repoPasswordEnc: settings.repoPassword === null ? null : encryptSecret(key, settings.repoPassword),
    schedule: settings.schedule,
    retention: settings.retention,
    lastRun: settings.lastRun,
    lastCheck: settings.lastCheck,
  };
  writeSetting(db, JSON.stringify(stored));
}

export function redactBackupSettings(settings: BackupSettings): RedactedBackupConfig {
  return {
    destination: settings.destination === null ? null : redactDestination(settings.destination),
    hasRepoPassword: settings.repoPassword !== null && settings.repoPassword !== "",
    schedule: settings.schedule,
    retention: settings.retention,
    lastRun: settings.lastRun,
    lastCheck: settings.lastCheck,
  };
}

function redactDestination(destination: BackupDestination): RedactedDestination {
  switch (destination.type) {
    case "local":
      return { type: "local", path: destination.path };
    case "sftp":
      return {
        type: "sftp",
        host: destination.host,
        port: destination.port,
        user: destination.user,
        path: destination.path,
      };
    case "rest":
      return {
        type: "rest",
        url: destination.url,
        ...(destination.username === undefined ? {} : { username: destination.username }),
        hasPassword: destination.password !== undefined && destination.password !== "",
      };
    case "s3":
      return {
        type: "s3",
        endpoint: destination.endpoint,
        bucket: destination.bucket,
        prefix: destination.prefix,
        ...(destination.region === undefined ? {} : { region: destination.region }),
        hasKeys: destination.accessKeyId !== "" && destination.secretAccessKey !== "",
      };
    case "rclone":
      return {
        type: "rclone",
        remote: destination.remote,
        path: destination.path,
        hasConfig: destination.rcloneConfig !== "",
      };
  }
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value === "") throw new Error(`${field} must be a non-empty string`);
  return value;
}

function optionalString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const SFTP_HOST_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9.-]{0,251}[A-Za-z0-9])?$/;
const SFTP_USER_PATTERN = /^[a-z_][a-z0-9_.-]{0,31}$/;
const SFTP_PATH_METACHAR_PATTERN = /["';|&$`<>]/;

function hasControlOrWhitespace(value: string): boolean {
  if (/\s/.test(value)) return true;
  return Array.from(value).some((char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return codePoint < 0x20 || (codePoint >= 0x7f && codePoint <= 0x9f);
  });
}

function rejectUnsafeName(value: string, field: string): void {
  if (value.startsWith("-") || hasControlOrWhitespace(value)) {
    throw new Error(`${field} must not start with '-' or contain whitespace or control characters`);
  }
}

/** Validate an API payload into a destination, or throw an Error with a clear message. */
export function parseDestination(value: unknown): BackupDestination {
  if (!isRecord(value)) throw new Error("destination must be an object");
  switch (value.type) {
    case "local": {
      const dir = requireString(value.path, "path");
      if (!dir.startsWith("/")) throw new Error("local destination path must be absolute");
      return { type: "local", path: dir };
    }
    case "sftp": {
      const host = requireString(value.host, "host");
      const user = requireString(value.user, "user");
      const dir = requireString(value.path, "path");
      const port = value.port === undefined ? 22 : value.port;
      if (host.startsWith("-") || (isIP(host) === 0 && !SFTP_HOST_PATTERN.test(host))) {
        throw new Error("sftp host must be a valid hostname or IP address");
      }
      if (!SFTP_USER_PATTERN.test(user)) {
        throw new Error("sftp user must be a valid SSH username");
      }
      if (
        (!dir.startsWith("/") && !dir.startsWith("~/")) ||
        dir.startsWith("-") ||
        hasControlOrWhitespace(dir) ||
        SFTP_PATH_METACHAR_PATTERN.test(dir)
      ) {
        throw new Error("sftp path must be absolute or start with ~/ and contain no shell metacharacters");
      }
      if (typeof port !== "number" || !Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error("sftp port must be an integer between 1 and 65535");
      }
      return { type: "sftp", host, port, user, path: dir };
    }
    case "rest": {
      const url = requireString(value.url, "url");
      let parsed: URL;
      try {
        parsed = new URL(url);
        if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error("bad protocol");
      } catch {
        throw new Error("rest url must be an http(s) URL");
      }
      if (parsed.username !== "" || parsed.password !== "" || parsed.search !== "") {
        throw new Error("put credentials in the username/password fields");
      }
      const username = typeof value.username === "string" && value.username !== "" ? value.username : undefined;
      const password = typeof value.password === "string" && value.password !== "" ? value.password : undefined;
      return {
        type: "rest",
        url,
        ...(username === undefined ? {} : { username }),
        ...(password === undefined ? {} : { password }),
      };
    }
    case "s3": {
      const endpoint = requireString(value.endpoint, "endpoint");
      const bucket = requireString(value.bucket, "bucket");
      const prefix = typeof value.prefix === "string" ? value.prefix : "";
      rejectUnsafeName(bucket, "s3 bucket");
      if (prefix !== "") rejectUnsafeName(prefix, "s3 prefix");
      const accessKeyId = optionalString(value.accessKeyId);
      const secretAccessKey = optionalString(value.secretAccessKey);
      const region = typeof value.region === "string" && value.region !== "" ? value.region : undefined;
      return {
        type: "s3",
        endpoint,
        bucket,
        prefix,
        accessKeyId,
        secretAccessKey,
        ...(region === undefined ? {} : { region }),
      };
    }
    case "rclone": {
      const remote = requireString(value.remote, "remote");
      rejectUnsafeName(remote, "rclone remote");
      const dir = typeof value.path === "string" ? value.path : "";
      const rcloneConfig = optionalString(value.rcloneConfig);
      return { type: "rclone", remote, path: dir, rcloneConfig };
    }
    default:
      throw new Error("destination type must be one of local, sftp, rest, s3, rclone");
  }
}

/** Throw when a destination is still missing credentials it cannot run without. */
export function requireDestinationSecrets(destination: BackupDestination): void {
  switch (destination.type) {
    case "s3":
      if (destination.accessKeyId === "" || destination.secretAccessKey === "") {
        throw new Error("s3 destination requires accessKeyId and secretAccessKey");
      }
      return;
    case "rclone":
      if (destination.rcloneConfig === "") {
        throw new Error("rclone destination requires an rclone configuration");
      }
      return;
    default:
      return;
  }
}

/**
 * Fill secret fields the client left blank (redacted on GET) from the stored
 * destination, so a PATCH-style re-init keeps existing credentials.
 */
export function mergeDestination(incoming: BackupDestination, stored: BackupDestination | null): BackupDestination {
  if (stored === null || stored.type !== incoming.type) return incoming;
  switch (incoming.type) {
    case "rest": {
      const password = incoming.password ?? (stored.type === "rest" ? stored.password : undefined);
      return { ...incoming, ...(password === undefined ? {} : { password }) };
    }
    case "s3": {
      const storedS3 = stored.type === "s3" ? stored : null;
      return {
        ...incoming,
        accessKeyId: incoming.accessKeyId === "" && storedS3 !== null ? storedS3.accessKeyId : incoming.accessKeyId,
        secretAccessKey:
          incoming.secretAccessKey === "" && storedS3 !== null ? storedS3.secretAccessKey : incoming.secretAccessKey,
      };
    }
    case "rclone": {
      const config =
        incoming.rcloneConfig === "" && stored.type === "rclone" ? stored.rcloneConfig : incoming.rcloneConfig;
      return { ...incoming, rcloneConfig: config };
    }
    default:
      return incoming;
  }
}
