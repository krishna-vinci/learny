import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

/** Where an engine binary was resolved from. */
export type EngineSource = "env" | "managed" | "path";

export interface EngineLocation {
  path: string;
  source: EngineSource;
  version: string | null;
}

export interface CommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunCommandOptions {
  timeoutMs: number;
  maxOutputBytes: number;
  signal?: AbortSignal;
  /** Private working directory; the runner never inherits the server's cwd. */
  cwd?: string;
  /** Minimal sanitized environment (no credentials/proxy vars). */
  env?: NodeJS.ProcessEnv;
}

export type RunCommand = (command: string, args: string[], options: RunCommandOptions) => Promise<CommandResult>;

/** Default `execFile` runner: no shell, bounded output, hard timeout, abortable. */
export const execFileRun: RunCommand = (command, args, options) =>
  new Promise((resolve) => {
    const child = execFile(
      command,
      args,
      {
        timeout: options.timeoutMs,
        maxBuffer: options.maxOutputBytes,
        windowsHide: true,
        ...(options.cwd ? { cwd: options.cwd } : {}),
        ...(options.env ? { env: options.env } : {}),
        ...(options.signal ? { signal: options.signal } : {}),
      },
      (error, stdout, stderr) => {
        const err = error as (Error & { code?: number | string; killed?: boolean; signal?: string }) | null;
        const timedOut = err?.killed === true || err?.signal === "SIGTERM";
        resolve({
          code: typeof err?.code === "number" ? err.code : err === null ? 0 : null,
          stdout: stdout ?? "",
          stderr: stderr ?? "",
          timedOut,
        });
      },
    );
    child.on("error", () => undefined);
  });

export interface EngineDiscoveryDeps {
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  run?: RunCommand;
  pathExists?: (target: string) => Promise<boolean>;
}

export interface EngineDiscovery {
  location: EngineLocation | null;
  /** True when YTDLP_PATH was set but did not point at a runnable binary. */
  envConfiguredButInvalid: boolean;
  /** True when a managed copy exists on disk. */
  managedPresent: boolean;
  /** True when a managed copy exists but an env/PATH binary is the active one. */
  managedShadowed: boolean;
}

export const MANAGED_ENGINE_RELATIVE = path.join("bin", "yt-dlp");
export const VERSION_TIMEOUT_MS = 5_000;
export const VERSION_MAX_OUTPUT_BYTES = 64 * 1024;

export function managedEnginePath(dataDir: string): string {
  return path.join(dataDir, MANAGED_ENGINE_RELATIVE);
}

async function fileExists(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}

async function versionOf(run: RunCommand, binary: string): Promise<string | null> {
  const result = await run(binary, ["--version"], {
    timeoutMs: VERSION_TIMEOUT_MS,
    maxOutputBytes: VERSION_MAX_OUTPUT_BYTES,
  }).catch(() => null);
  if (result === null || result.code !== 0 || result.timedOut) return null;
  const first = result.stdout
    .split(/\r?\n/)
    .find((line) => line.trim() !== "")
    ?.trim();
  return first === undefined || first === "" ? null : first;
}

/**
 * Resolve yt-dlp in the owner's documented order: `YTDLP_PATH`, then the
 * configured data directory's `bin/yt-dlp`, then `yt-dlp` on PATH. A missing
 * binary is a normal state (today's behaviour), never an error.
 */
export async function discoverEngine(deps: EngineDiscoveryDeps): Promise<EngineDiscovery> {
  const run = deps.run ?? execFileRun;
  const exists = deps.pathExists ?? fileExists;
  const envPath = deps.env?.YTDLP_PATH?.trim();
  const managed = managedEnginePath(deps.dataDir);
  const managedPresent = await exists(managed);

  let envConfiguredButInvalid = false;
  if (envPath !== undefined && envPath !== "") {
    if (await exists(envPath)) {
      const version = await versionOf(run, envPath);
      if (version !== null) {
        return {
          location: { path: envPath, source: "env", version },
          envConfiguredButInvalid: false,
          managedPresent,
          managedShadowed: managedPresent,
        };
      }
    }
    // A bad override must not brick the integration: remember it, then fall
    // back through the documented order so a managed copy still works.
    envConfiguredButInvalid = true;
  }

  if (managedPresent) {
    const version = await versionOf(run, managed);
    if (version !== null) {
      return {
        location: { path: managed, source: "managed", version },
        envConfiguredButInvalid,
        managedPresent,
        managedShadowed: false,
      };
    }
  }

  const version = await versionOf(run, "yt-dlp");
  if (version !== null) {
    return {
      location: { path: "yt-dlp", source: "path", version },
      envConfiguredButInvalid,
      managedPresent,
      managedShadowed: managedPresent,
    };
  }
  return { location: null, envConfiguredButInvalid, managedPresent, managedShadowed: false };
}
