import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import type { YoutubeIntegrationStatus } from "@studium/shared";
import { safeFetch } from "../ingest/safe-fetch.js";
import { type CookieStatus, CookieStore } from "./cookies.js";
import { discoverEngine, type EngineLocation, execFileRun, managedEnginePath, type RunCommand } from "./engine.js";
import { parseJson3 } from "./json3.js";
import type {
  EngineRunMode,
  EngineSegment,
  TranscriptAttempt,
  TranscriptFailureKind,
  YoutubeMetadata,
  YoutubeTranscriptEngine,
} from "./types.js";
import {
  EngineInstallError,
  engineAssetFor,
  installEngine,
  PLATFORM_UNSUPPORTED_MESSAGE,
  platformLabelFor,
} from "./update.js";

/** Politely space yt-dlp starts so bursts never re-trip YouTube's wall. */
export const START_SPACING_MS = 2_000;
/** One transient retry, no sooner than this after the first failure. */
export const RETRY_DELAY_MS = 5_000;
export const TRANSCRIPT_TIMEOUT_MS = 60_000;
export const TRANSCRIPT_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
export const SUBTITLE_MAX_BYTES = 4 * 1024 * 1024;
export const THUMBNAIL_MAX_BYTES = 5 * 1024 * 1024;
export const ENGINE_CACHE_MS = 15_000;

/** Hosts the caption/thumbnail fetches may reach. */
export const YOUTUBE_MEDIA_HOSTS = [
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
  "i.ytimg.com",
] as const;

const WATCH_HOSTS = [
  "www.youtube.com",
  "youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "www.youtube-nocookie.com",
  "youtube-nocookie.com",
] as const;

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;

export interface YoutubeNotifier {
  notifyAdmins(notification: { title: string; body: string; url?: string }): Promise<void>;
}

export interface YoutubeServiceDeps {
  dataDir: string;
  secretsKey: Buffer;
  env?: NodeJS.ProcessEnv;
  notifier?: YoutubeNotifier;
  platform?: string;
  arch?: string;
  nodeExecPath?: string;
  safeFetchImpl?: typeof safeFetch;
  runCommand?: RunCommand;
  pathExists?: (target: string) => Promise<boolean>;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
  log?: (message: string) => void;
  startSpacingMs?: number;
  retryDelayMs?: number;
}

interface CaptionTrack {
  url: string;
  lang: string;
  origin: "original" | "curated" | "auto" | "fallback";
}

interface YtdlpMetadata {
  title?: unknown;
  uploader?: unknown;
  subtitles?: unknown;
  automatic_captions?: unknown;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort(): void {
      clearTimeout(timer);
      reject(abortError());
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** Only json3 tracks are usable; anything else is a failure, never "no captions". */
function trackList(value: unknown): Array<[string, string]> {
  if (typeof value !== "object" || value === null) return [];
  const out: Array<[string, string]> = [];
  for (const [lang, entries] of Object.entries(value as Record<string, unknown>)) {
    if (!Array.isArray(entries)) continue;
    const json3 = entries.find(
      (entry) =>
        typeof entry === "object" &&
        entry !== null &&
        (entry as { ext?: unknown }).ext === "json3" &&
        typeof (entry as { url?: unknown }).url === "string",
    );
    if (json3 !== undefined) out.push([lang, (json3 as { url: string }).url]);
  }
  return out;
}

function englishKey(keys: string[], exactFirst: boolean): string | null {
  if (exactFirst && keys.includes("en")) return "en";
  return keys.find((key) => /^en(-|$)/i.test(key) && key.toLowerCase() !== "en-orig") ?? null;
}

/** Prefer the video's own original-language track over auto-translated ones. */
function originalKey(keys: string[]): string | null {
  return keys.find((key) => /-orig$/i.test(key)) ?? null;
}

/**
 * Choose exactly one track: the original-English auto track (finer timing),
 * then curated English, then English auto captions, then one original track.
 * Never concatenates language variants.
 */
export function selectCaptionTrack(meta: YtdlpMetadata): CaptionTrack | null {
  const curated = trackList(meta.subtitles);
  const auto = trackList(meta.automatic_captions);
  const curatedKeys = curated.map(([lang]) => lang);
  const autoKeys = auto.map(([lang]) => lang);

  if (autoKeys.includes("en-orig")) {
    const url = auto[autoKeys.indexOf("en-orig")]?.[1];
    if (url !== undefined) return { url, lang: "en-orig", origin: "original" };
  }
  const curatedKey = englishKey(curatedKeys, true);
  if (curatedKey !== null) {
    const url = curated[curatedKeys.indexOf(curatedKey)]?.[1];
    if (url !== undefined) return { url, lang: curatedKey, origin: "curated" };
  }
  const autoKey = englishKey(autoKeys, true);
  if (autoKey !== null) {
    const url = auto[autoKeys.indexOf(autoKey)]?.[1];
    if (url !== undefined) return { url, lang: autoKey, origin: "auto" };
  }
  const originalAuto = originalKey(autoKeys);
  const originalCurated = originalKey(curatedKeys);
  const fallbackLang = originalCurated ?? originalAuto ?? curatedKeys[0] ?? autoKeys[0];
  if (fallbackLang === undefined) return null;
  const fromCurated = curatedKeys.includes(fallbackLang);
  const list = fromCurated ? curated : auto;
  const keys = fromCurated ? curatedKeys : autoKeys;
  const url = list[keys.indexOf(fallbackLang)]?.[1];
  return url === undefined ? null : { url, lang: fallbackLang, origin: "fallback" };
}

/**
 * Classify a yt-dlp failure. A bot/sign-in wall or a 429 is always `blocked`
 * (retryable); only explicit expired/invalid-cookie evidence is `stale-cookie`.
 */
export function classifyFailure(stderr: string): TranscriptFailureKind {
  const text = stderr.toLowerCase();
  if (/rate.?limit|too many requests|http error 429/.test(text)) return "blocked";
  if (/sign in to confirm|confirm you'?re not a bot|not a bot/.test(text)) return "blocked";
  if (/cookie[^\n.]*\b(expired|invalid|no longer valid|revoked|corrupt)\b/.test(text)) return "stale-cookie";
  if (/\b(expired|invalid|revoked)\b[^\n.]*cookie/.test(text)) return "stale-cookie";
  if (/subtitles? (?:are|were) disabled|captions? (?:are|were) disabled|no automatic captions/.test(text))
    return "disabled";
  if (/no subtitles|there are no subtitles|no captions|does not have any subtitles/.test(text)) return "no-captions";
  if (
    /video unavailable|this video is unavailable|private video|has been removed|removed by the uploader|not available/.test(
      text,
    )
  )
    return "unavailable";
  return "extraction-error";
}

function retryable(kind: TranscriptFailureKind): boolean {
  return kind === "blocked" || kind === "extraction-error";
}

interface CachedDiscovery {
  at: number;
  location: EngineLocation | null;
  envConfiguredButInvalid: boolean;
  managedPresent: boolean;
  managedShadowed: boolean;
}

/**
 * Instance-wide YouTube integration service: engine discovery, verified
 * install/update, encrypted cookie storage, status and paced subprocess runs.
 */
export class YoutubeService implements YoutubeTranscriptEngine {
  readonly #dataDir: string;
  readonly #env: NodeJS.ProcessEnv;
  readonly #platform: string;
  readonly #arch: string;
  readonly #nodeExecPath: string;
  readonly #safeFetchImpl: typeof safeFetch;
  readonly #runCommand: RunCommand;
  readonly #pathExists: ((target: string) => Promise<boolean>) | undefined;
  readonly #sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  readonly #now: () => number;
  readonly #log: (message: string) => void;
  readonly #notifier: YoutubeNotifier | undefined;
  readonly #startSpacingMs: number;
  readonly #retryDelayMs: number;
  readonly #cookies: CookieStore;

  #discovery: CachedDiscovery | null = null;
  #installLock: Promise<unknown> = Promise.resolve();
  #queue: Promise<void> = Promise.resolve();
  #lastStartAt = 0;
  #cookiesConfigured = false;
  #updateRecommended = false;

  constructor(deps: YoutubeServiceDeps) {
    this.#dataDir = deps.dataDir;
    this.#env = deps.env ?? process.env;
    this.#platform = deps.platform ?? process.platform;
    this.#arch = deps.arch ?? process.arch;
    this.#nodeExecPath = deps.nodeExecPath ?? process.execPath;
    this.#safeFetchImpl = deps.safeFetchImpl ?? safeFetch;
    this.#runCommand = deps.runCommand ?? execFileRun;
    this.#pathExists = deps.pathExists;
    this.#sleep = deps.sleep ?? sleep;
    this.#now = deps.now ?? (() => Date.now());
    this.#log = deps.log ?? (() => undefined);
    this.#notifier = deps.notifier;
    this.#startSpacingMs = deps.startSpacingMs ?? START_SPACING_MS;
    this.#retryDelayMs = deps.retryDelayMs ?? RETRY_DELAY_MS;
    this.#cookies = new CookieStore({ dataDir: deps.dataDir, secretsKey: deps.secretsKey, env: this.#env });
  }

  hasCredentials(): boolean {
    return this.#cookiesConfigured;
  }

  /** Await a fresh credential state (env re-export/replace detection included). */
  async #ensureCredentials(): Promise<CookieStatus> {
    const status = await this.#cookies.refresh();
    this.#cookiesConfigured = status.configured && status.readable;
    return status;
  }

  async #discover(force = false): Promise<CachedDiscovery> {
    const cached = this.#discovery;
    if (!force && cached !== null && this.#now() - cached.at < ENGINE_CACHE_MS) return cached;
    const discovered = await discoverEngine({
      dataDir: this.#dataDir,
      env: this.#env,
      run: this.#runCommand,
      ...(this.#pathExists === undefined ? {} : { pathExists: this.#pathExists }),
    });
    const next: CachedDiscovery = { at: this.#now(), ...discovered };
    this.#discovery = next;
    return next;
  }

  async status(): Promise<YoutubeIntegrationStatus> {
    const [discovery, cookies] = await Promise.all([this.#discover(), this.#ensureCredentials()]);
    return this.#buildStatus(discovery, cookies);
  }

  #buildStatus(discovery: CachedDiscovery, cookies: CookieStatus): YoutubeIntegrationStatus {
    const location = discovery.location;
    const asset = engineAssetFor(this.#platform, this.#arch);
    const stale = cookies.stale && cookies.configured && cookies.readable;
    const mode: YoutubeIntegrationStatus["mode"] =
      location === null ? "basic" : cookies.configured && cookies.readable && !stale ? "signed-in" : "improved";
    const modeLabel =
      mode === "basic"
        ? "Transcripts: basic"
        : stale
          ? "Transcripts: sign-in expired — re-export cookies"
          : mode === "signed-in"
            ? `Transcripts: improved + signed-in (yt-dlp ${location?.version ?? "installed"})`
            : `Transcripts: improved (yt-dlp ${location?.version ?? "installed"})`;
    return {
      engine: {
        state: location === null ? "missing" : "found",
        source: location?.source ?? null,
        version: location?.version ?? null,
        asset,
        platformSupported: asset !== null,
        platformLabel: platformLabelFor(this.#platform, this.#arch),
        nodePresent: true,
        managedInstalled: discovery.managedPresent,
        managedVersion: location?.source === "managed" ? (location.version ?? null) : null,
        managedShadowed: discovery.managedShadowed,
        envOverrideInvalid: discovery.envConfiguredButInvalid,
      },
      cookies: {
        source: cookies.source,
        configured: cookies.configured,
        readable: cookies.readable,
        stale,
        lastSuccessAt: cookies.lastSuccessAt,
        lastSuccessVideoId: cookies.lastSuccessVideoId,
      },
      mode,
      modeLabel,
      updateRecommended: this.#updateRecommended,
    };
  }

  install(): Promise<YoutubeIntegrationStatus> {
    return this.#installOrUpdate();
  }

  update(): Promise<YoutubeIntegrationStatus> {
    return this.#installOrUpdate();
  }

  #installOrUpdate(): Promise<YoutubeIntegrationStatus> {
    const run = this.#installLock.then(async () => {
      if (engineAssetFor(this.#platform, this.#arch) === null)
        throw new EngineInstallError(PLATFORM_UNSUPPORTED_MESSAGE);
      await installEngine({
        dataDir: this.#dataDir,
        platform: this.#platform,
        arch: this.#arch,
        fetchImpl: this.#safeFetchImpl,
        log: this.#log,
      });
      this.#updateRecommended = false;
      await this.#discover(true);
      return this.status();
    });
    this.#installLock = run.catch(() => undefined);
    return run;
  }

  async uploadCookies(plaintext: string): Promise<YoutubeIntegrationStatus> {
    await this.#cookies.upload(plaintext);
    return this.status();
  }

  async removeCookies(): Promise<YoutubeIntegrationStatus> {
    await this.#cookies.remove();
    return this.status();
  }

  /** oEmbed + thumbnail metadata; never invents a title or author. */
  async metadata(videoId: string, options: { signal?: AbortSignal } = {}): Promise<YoutubeMetadata> {
    if (!VIDEO_ID_PATTERN.test(videoId)) return { title: null, author: null, thumbnail: null };
    const signal = options.signal;
    if (signal?.aborted) throw abortError();
    let title: string | null = null;
    let author: string | null = null;
    try {
      const response = await this.#safeFetchImpl(
        `https://www.youtube.com/oembed?url=${encodeURIComponent(`https://www.youtube.com/watch?v=${videoId}`)}&format=json`,
        { httpsOnly: true, allowedHosts: WATCH_HOSTS, maxBytes: 512 * 1024, ...(signal ? { signal } : {}) },
      );
      const parsed: unknown = JSON.parse(new TextDecoder().decode(response.bytes));
      if (typeof parsed === "object" && parsed !== null) {
        const record = parsed as { title?: unknown; author_name?: unknown };
        if (typeof record.title === "string" && record.title.trim() !== "") title = record.title.trim();
        if (typeof record.author_name === "string" && record.author_name.trim() !== "")
          author = record.author_name.trim();
      }
    } catch (error) {
      if (isAbort(error) || signal?.aborted) throw abortError();
      /* Metadata is best-effort; the source is still embeddable without it. */
    }

    let thumbnail: Uint8Array | null = null;
    try {
      const response = await this.#safeFetchImpl(`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`, {
        httpsOnly: true,
        allowedHosts: YOUTUBE_MEDIA_HOSTS,
        maxBytes: THUMBNAIL_MAX_BYTES,
        ...(signal ? { signal } : {}),
      });
      if (
        response.contentType?.split(";")[0] === "image/jpeg" &&
        response.bytes[0] === 255 &&
        response.bytes[1] === 216
      ) {
        thumbnail = response.bytes;
      }
    } catch (error) {
      if (isAbort(error) || signal?.aborted) throw abortError();
      /* Thumbnail failure must not discard metadata. */
    }
    return { title, author, thumbnail };
  }

  /**
   * Run the ladder's yt-dlp rung: paced, with one transient retry, classifying
   * failures and (for signed-in runs only) touching the credential copy.
   */
  async transcript(
    videoId: string,
    options: { signal?: AbortSignal; mode?: EngineRunMode } = {},
  ): Promise<TranscriptAttempt> {
    const mode = options.mode ?? "anonymous";
    const signal = options.signal;
    if (!VIDEO_ID_PATTERN.test(videoId)) return { ok: false, kind: "unavailable", retryable: false };
    if (signal?.aborted) throw abortError();

    const discovery = await this.#discover();
    if (discovery.location === null) return { ok: false, kind: "engine-missing", retryable: false };
    // Refresh credential state before the ladder decides whether to sign in.
    await this.#ensureCredentials();

    return this.#withSlot(async () => {
      const location = discovery.location as EngineLocation;
      if (signal?.aborted) throw abortError();
      const first = await this.#runTranscript(videoId, location, mode, signal);
      let attempt = first;
      if (first.ok === false && first.retryable === true && !signal?.aborted) {
        await this.#sleep(this.#retryDelayMs, signal);
        if (signal?.aborted) throw abortError();
        attempt = await this.#runTranscript(videoId, location, mode, signal);
      }
      await this.#noteOutcome(attempt);
      return attempt;
    }, signal);
  }

  async #noteOutcome(attempt: TranscriptAttempt): Promise<void> {
    if (attempt.ok) return;
    if (attempt.kind === "extraction-error") this.#updateRecommended = true;
  }

  async #runTranscript(
    videoId: string,
    location: EngineLocation,
    mode: EngineRunMode,
    signal?: AbortSignal,
  ): Promise<TranscriptAttempt> {
    if (mode === "signed-in") {
      // Only a signed-in run may decrypt/copy the credential or pass --cookies.
      return this.#cookies.withRunCopy(async (cookieFile, generation) => {
        if (cookieFile === null) return { ok: false, kind: "stale-cookie", retryable: false };
        const attempt = await this.#execute(videoId, location, cookieFile, signal);
        if (attempt.ok) {
          await this.#cookies.recordSuccess(videoId, generation).catch(() => undefined);
        } else if (attempt.kind === "stale-cookie") {
          const first = await this.#cookies.markStale(generation).catch(() => false);
          if (first) {
            void this.#notifier
              ?.notifyAdmins({
                title: "YouTube sign-in expired",
                body: "Re-export the YouTube cookies in Settings → Integrations → YouTube to keep transcripts working.",
                url: "/settings/integrations",
              })
              .catch(() => undefined);
          }
        }
        return attempt;
      });
    }
    return this.#execute(videoId, location, null, signal);
  }

  /** One subprocess run: no credentials for anonymous, private cwd + env. */
  async #execute(
    videoId: string,
    location: EngineLocation,
    cookieFile: string | null,
    signal?: AbortSignal,
  ): Promise<TranscriptAttempt> {
    if (signal?.aborted) throw abortError();
    await this.#waitForSpacing(signal);
    if (signal?.aborted) throw abortError();
    const dir = await fs.mkdtemp(path.join(tmpdir(), "studium-ytdlp-run-"));
    try {
      const args = [
        "--ignore-config",
        "--no-playlist",
        "--skip-download",
        "--no-cache-dir",
        "--no-plugin-dirs",
        "--no-remote-components",
        "--no-js-runtimes",
        "--js-runtimes",
        `node:${this.#nodeExecPath}`,
        "--no-warnings",
        "--proxy",
        "",
        "--dump-single-json",
        ...(cookieFile === null ? [] : ["--cookies", cookieFile]),
        `https://www.youtube.com/watch?v=${videoId}`,
      ];
      const result = await this.#runCommand(location.path, args, {
        timeoutMs: TRANSCRIPT_TIMEOUT_MS,
        maxOutputBytes: TRANSCRIPT_MAX_OUTPUT_BYTES,
        cwd: dir,
        env: { PATH: this.#env.PATH ?? "/usr/bin:/bin", HOME: dir, TMPDIR: dir, LANG: "C.UTF-8", NO_COLOR: "1" },
        ...(signal ? { signal } : {}),
      });
      if (signal?.aborted) throw abortError();
      if (result.timedOut) return { ok: false, kind: "blocked", retryable: true };

      let meta: YtdlpMetadata | null = null;
      try {
        const parsed: unknown = JSON.parse(result.stdout);
        if (typeof parsed === "object" && parsed !== null) meta = parsed as YtdlpMetadata;
      } catch {
        meta = null;
      }
      if (meta === null) {
        const kind = classifyFailure(result.stderr);
        return { ok: false, kind, retryable: retryable(kind) };
      }

      const track = selectCaptionTrack(meta);
      if (track === null) {
        const hasTrackLists =
          (typeof meta.subtitles === "object" && meta.subtitles !== null) ||
          (typeof meta.automatic_captions === "object" && meta.automatic_captions !== null);
        const anyEntries =
          (meta.subtitles !== null && typeof meta.subtitles === "object"
            ? Object.keys(meta.subtitles as object).length
            : 0) +
            (meta.automatic_captions !== null && typeof meta.automatic_captions === "object"
              ? Object.keys(meta.automatic_captions as object).length
              : 0) >
          0;
        // A track list existed but no json3 was offered: that is an engine
        // shortfall, not proof the video has no captions.
        if (hasTrackLists && anyEntries) return { ok: false, kind: "extraction-error", retryable: true };
        return { ok: false, kind: "no-captions", retryable: false };
      }

      let payload: string;
      try {
        const response = await this.#safeFetchImpl(track.url, {
          httpsOnly: true,
          allowedHosts: YOUTUBE_MEDIA_HOSTS,
          maxBytes: SUBTITLE_MAX_BYTES,
          ...(signal ? { signal } : {}),
        });
        payload = new TextDecoder().decode(response.bytes);
      } catch (error) {
        if (isAbort(error) || signal?.aborted) throw abortError();
        return { ok: false, kind: "extraction-error", retryable: true };
      }
      const segments: EngineSegment[] = parseJson3(payload);
      // An advertised track that yields no segments is an engine failure, never
      // evidence of absent captions.
      if (segments.length === 0) return { ok: false, kind: "extraction-error", retryable: true };
      const title = typeof meta.title === "string" && meta.title.trim() !== "" ? meta.title.trim() : undefined;
      const author =
        typeof meta.uploader === "string" && meta.uploader.trim() !== "" ? meta.uploader.trim() : undefined;
      return {
        ok: true,
        segments,
        ...(title === undefined ? {} : { title }),
        ...(author === undefined ? {} : { author }),
      };
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /**
   * Enforce the minimum spacing before every actual subprocess start, so a
   * retry cannot start immediately after the previous run (or push the next
   * queued video inside the window).
   */
  async #waitForSpacing(signal?: AbortSignal): Promise<void> {
    const waitMs = Math.max(0, this.#lastStartAt + this.#startSpacingMs - this.#now());
    if (waitMs > 0) await this.#sleep(waitMs, signal);
    if (signal?.aborted) throw abortError();
    this.#lastStartAt = this.#now();
  }

  /** Serialize yt-dlp runs; aborting a waiter never starts a subprocess. */
  async #withSlot<T>(fn: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    if (signal?.aborted) throw abortError();
    const previous = this.#queue;
    let release!: () => void;
    this.#queue = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await previous;
      if (signal?.aborted) throw abortError();
      return await fn();
    } finally {
      release();
    }
  }

  /** Test/diagnostic helper: the managed path Install/Update targets. */
  managedEnginePath(): string {
    return managedEnginePath(this.#dataDir);
  }
}
