import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { type SafeFetchResponse, safeFetch } from "../ingest/safe-fetch.js";
import { managedEnginePath } from "./engine.js";

/** Official hosts the verified updater may contact, including redirects. */
export const RELEASE_ALLOWED_HOSTS = [
  "api.github.com",
  "github.com",
  "release-assets.githubusercontent.com",
  "objects.githubusercontent.com",
] as const;

export const RELEASE_API = "https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest";
export const RELEASE_TAG_PATTERN = /^\d{4}\.\d{2}\.\d{2}(?:\.\d+)?$/;
/** Bounded download: the standalone binary is well under this. */
export const ENGINE_MAX_BYTES = 100 * 1024 * 1024;
export const UPDATER_TIMEOUT_MS = 120_000;

export class EngineInstallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EngineInstallError";
  }
}

export const PLATFORM_UNSUPPORTED_MESSAGE = "yt-dlp is not available on this server.";

/**
 * The pinned official asset for this host, or null when unsupported. Linux
 * covers x86_64 and aarch64 (Raspberry Pi 64-bit); macOS covers both arches.
 */
export function engineAssetFor(platform: string, arch: string): string | null {
  if (platform === "linux") {
    if (arch === "x64") return "yt-dlp_linux";
    if (arch === "arm64") return "yt-dlp_linux_aarch64";
    return null;
  }
  if (platform === "darwin" && (arch === "x64" || arch === "arm64")) return "yt-dlp_macos";
  return null;
}

export function platformLabelFor(platform: string, arch: string): string {
  const archName = arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : arch;
  return `${platform} ${archName}`;
}

/** Parse a `SHA2-256SUMS` line list into a filename → lowercase hex map. */
export function parseChecksums(text: string): Map<string, string> {
  const sums = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*([0-9a-fA-F]{64})\s+\*?(.+?)\s*$/.exec(line);
    if (match === null) continue;
    sums.set(match[2] as string, (match[1] as string).toLowerCase());
  }
  return sums;
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export interface EngineUpdaterDeps {
  dataDir: string;
  platform?: string;
  arch?: string;
  fetchImpl?: typeof safeFetch;
  log?: (message: string) => void;
}

export interface InstallResult {
  version: string;
  path: string;
}

function fetchJson(fetchImpl: typeof safeFetch, url: string, signal?: AbortSignal): Promise<SafeFetchResponse> {
  return fetchImpl(url, {
    httpsOnly: true,
    allowedHosts: RELEASE_ALLOWED_HOSTS,
    maxBytes: 2 * 1024 * 1024,
    timeoutMs: UPDATER_TIMEOUT_MS,
    headers: { accept: "application/vnd.github+json", "user-agent": "studium-yt-dlp-updater" },
    ...(signal ? { signal } : {}),
  });
}

/**
 * Download the latest official yt-dlp release for this host, verify its
 * SHA-256 against the release's published checksums, and atomically replace
 * `data/bin/yt-dlp` with mode 0755. The previous binary is kept on any failure
 * and a downloaded binary is never executed before verification.
 */
export async function installEngine(deps: EngineUpdaterDeps & { signal?: AbortSignal }): Promise<InstallResult> {
  const platform = deps.platform ?? process.platform;
  const arch = deps.arch ?? process.arch;
  const fetchImpl = deps.fetchImpl ?? safeFetch;
  const log = deps.log ?? (() => undefined);
  const asset = engineAssetFor(platform, arch);
  if (asset === null) throw new EngineInstallError(PLATFORM_UNSUPPORTED_MESSAGE);

  const meta = await fetchJson(fetchImpl, RELEASE_API, deps.signal);
  let tag: unknown;
  try {
    tag = (JSON.parse(new TextDecoder().decode(meta.bytes)) as { tag_name?: unknown }).tag_name;
  } catch {
    throw new EngineInstallError("The yt-dlp release list could not be read.");
  }
  if (typeof tag !== "string" || !RELEASE_TAG_PATTERN.test(tag)) {
    throw new EngineInstallError("The yt-dlp release list did not contain a usable version.");
  }

  const base = `https://github.com/yt-dlp/yt-dlp/releases/download/${tag}`;
  const checksums = await fetchImpl(`${base}/SHA2-256SUMS`, {
    httpsOnly: true,
    allowedHosts: RELEASE_ALLOWED_HOSTS,
    maxBytes: 1024 * 1024,
    timeoutMs: UPDATER_TIMEOUT_MS,
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
  const expected = parseChecksums(new TextDecoder().decode(checksums.bytes)).get(asset);
  if (expected === undefined) {
    throw new EngineInstallError(`The yt-dlp release did not publish a checksum for ${asset}.`);
  }

  log(`downloading yt-dlp ${tag} (${asset})`);
  const binary = await fetchImpl(`${base}/${asset}`, {
    httpsOnly: true,
    allowedHosts: RELEASE_ALLOWED_HOSTS,
    maxBytes: ENGINE_MAX_BYTES,
    timeoutMs: UPDATER_TIMEOUT_MS,
    ...(deps.signal ? { signal: deps.signal } : {}),
  });
  const actual = sha256Hex(binary.bytes);
  if (actual !== expected) {
    throw new EngineInstallError("The downloaded yt-dlp binary did not match its published checksum.");
  }

  const target = managedEnginePath(deps.dataDir);
  const dir = path.dirname(target);
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const tmp = path.join(dir, `.yt-dlp.${randomBytes(8).toString("hex")}.tmp`);
  try {
    // Exclusive create + chmod before the atomic rename: nothing runs after the
    // replacement that could fail and leave a half-claimed install.
    await fs.writeFile(tmp, binary.bytes, { mode: 0o755, flag: "wx" });
    await fs.chmod(tmp, 0o755);
    await fs.rename(tmp, target);
  } catch (error) {
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw error;
  }
  log(`installed yt-dlp ${tag}`);
  return { version: tag, path: target };
}
