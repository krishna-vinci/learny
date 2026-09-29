import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { type BackupDestination, destinationSecrets } from "./config.js";

export const RESTIC_BINARY = "restic";

export interface ResticResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface ResticRunOptions {
  dataDir: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

function backupDir(dataDir: string): string {
  return path.join(dataDir, ".backup");
}

export function sftpKeyPath(dataDir: string): string {
  return path.join(backupDir(dataDir), "id_ed25519");
}

export function sftpKnownHostsPath(dataDir: string): string {
  return path.join(backupDir(dataDir), "known_hosts");
}

export function rcloneConfigPath(dataDir: string): string {
  return path.join(backupDir(dataDir), "rclone.conf");
}

export function stagingDbPath(dataDir: string): string {
  return path.join(backupDir(dataDir), "studium.db");
}

/** The restic repository string for a destination. */
export function repositoryString(destination: BackupDestination): string {
  switch (destination.type) {
    case "local":
      return destination.path;
    case "sftp":
      return `sftp:${destination.user}@${destination.host}:${destination.path}`;
    case "rest":
      return destination.url;
    case "s3": {
      const endpoint = destination.endpoint.replace(/\/+$/, "");
      const prefix = destination.prefix.replace(/^\/+|\/+$/g, "");
      return `s3:${endpoint}/${destination.bucket}${prefix === "" ? "" : `/${prefix}`}`;
    }
    case "rclone":
      return `rclone:${destination.remote}:${destination.path}`;
  }
}

/** The env restic runs with: an allow-list only, never the whole process.env. */
export function buildResticEnv(
  destination: BackupDestination,
  password: string,
  dataDir: string,
): Record<string, string> {
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin",
    HOME: path.join(backupDir(dataDir), "home"),
    RESTIC_PASSWORD: password,
    RESTIC_REPOSITORY: repositoryString(destination),
  };
  if (destination.type === "s3") {
    env.AWS_ACCESS_KEY_ID = destination.accessKeyId;
    env.AWS_SECRET_ACCESS_KEY = destination.secretAccessKey;
    if (destination.region !== undefined && destination.region !== "") env.AWS_DEFAULT_REGION = destination.region;
  }
  if (destination.type === "rest") {
    if (destination.username !== undefined && destination.username !== "") {
      env.RESTIC_REST_USERNAME = destination.username;
    }
    if (destination.password !== undefined && destination.password !== "") {
      env.RESTIC_REST_PASSWORD = destination.password;
    }
  }
  if (destination.type === "rclone") env.RCLONE_CONFIG = rcloneConfigPath(dataDir);
  return env;
}

function sftpExtraArgs(destination: Extract<BackupDestination, { type: "sftp" }>, dataDir: string): string[] {
  const key = sftpKeyPath(dataDir);
  const command = [
    "ssh",
    "-p",
    String(destination.port),
    "-i",
    key,
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `UserKnownHostsFile=${sftpKnownHostsPath(dataDir)}`,
  ].join(" ");
  return ["-o", `sftp.command=${command}`];
}

function prepareDestination(destination: BackupDestination, dataDir: string): string[] {
  const dir = backupDir(dataDir);
  mkdirSync(path.join(dir, "home"), { recursive: true, mode: 0o700 });
  if (destination.type === "sftp") {
    if (!existsSync(sftpKeyPath(dataDir))) {
      throw new Error("sftp key has not been generated yet; call POST /api/admin/backups/sftp-key first");
    }
  }
  if (destination.type === "rclone") {
    const raw = destination.rcloneConfig.endsWith("\n") ? destination.rcloneConfig : `${destination.rcloneConfig}\n`;
    const config = raw.startsWith("[") ? raw : `[${destination.remote}]\n${raw}`;
    writeFileSync(rcloneConfigPath(dataDir), config, { mode: 0o600 });
    chmodSync(rcloneConfigPath(dataDir), 0o600);
  }
  return destination.type === "sftp" ? sftpExtraArgs(destination, dataDir) : [];
}

/** Replace every secret occurrence with a fixed marker. */
export function redactSecrets(text: string, secrets: readonly string[]): string {
  let redacted = text;
  for (const secret of secrets) {
    if (secret === "") continue;
    redacted = redacted.split(secret).join("***");
    const encoded = encodeURIComponent(secret);
    if (encoded !== secret) redacted = redacted.split(encoded).join("***");
  }
  return redacted;
}

export function secretsFor(destination: BackupDestination, password: string): string[] {
  return [password, ...destinationSecrets(destination)].filter((value) => value !== "");
}

/**
 * Run restic with the destination's credentials. The env is built from an
 * allow-list so unrelated process variables never reach the child process.
 */
export async function runRestic(
  args: string[],
  destination: BackupDestination,
  password: string,
  options: ResticRunOptions,
): Promise<ResticResult> {
  const extraArgs = prepareDestination(destination, options.dataDir);
  const env = buildResticEnv(destination, password, options.dataDir);

  return await new Promise<ResticResult>((resolve, reject) => {
    const child = spawn(RESTIC_BINARY, [...extraArgs, ...args, "--json"], { env, signal: options.signal });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer =
      options.timeoutMs === undefined || options.timeoutMs <= 0
        ? null
        : setTimeout(() => {
            timedOut = true;
            child.kill("SIGKILL");
          }, options.timeoutMs);

    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      if (timer !== null) clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      if (timer !== null) clearTimeout(timer);
      const suffix = timedOut ? `\nrestic timed out after ${options.timeoutMs}ms` : "";
      resolve({ code: timedOut ? -1 : (code ?? -1), stdout, stderr: stderr + suffix });
    });
  });
}

export function isMissingRepository(text: string): boolean {
  return (
    text.includes("unable to open config file") ||
    text.includes("Is there a repository at the following location") ||
    text.includes("repository does not exist") ||
    text.includes("The specified key does not exist")
  );
}

export function isAuthError(text: string): boolean {
  return text.includes("wrong password") || text.includes("no key found");
}

/** Human-readable, secret-free message for a failed restic invocation. */
export function formatResticFailure(result: ResticResult, secrets: readonly string[]): string {
  const text = (result.stderr.trim() || result.stdout.trim() || `restic exited with code ${result.code}`).trim();
  return redactSecrets(text, secrets);
}

/** `restic version` needs no repository, so it runs with a minimal env. */
export async function resticVersion(): Promise<string> {
  return await new Promise<string>((resolve) => {
    const child = spawn(RESTIC_BINARY, ["version"], {
      env: { PATH: process.env.PATH ?? "/usr/local/bin:/usr/bin:/bin" },
    });
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.on("error", () => resolve("unknown"));
    child.on("close", () => resolve(stdout.trim().split("\n")[0] ?? "unknown"));
  });
}

/** Parse the trailing JSON summary restic prints for `backup --json`. */
export function parseSnapshotId(stdout: string): string | null {
  let id: string | null = null;
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || !trimmed.startsWith("{")) continue;
    try {
      const parsed = JSON.parse(trimmed) as { message_type?: string; snapshot_id?: string };
      if (parsed.message_type === "summary" && typeof parsed.snapshot_id === "string") id = parsed.snapshot_id;
    } catch {
      // Not a JSON line (e.g. a password prompt); ignore it.
    }
  }
  return id;
}
