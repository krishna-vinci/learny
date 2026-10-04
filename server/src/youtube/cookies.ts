import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { decryptSecret, encryptSecret } from "../db/crypto.js";

/** Hard cap for an uploaded cookie jar (owner ruling: <= 1 MB). */
export const COOKIES_MAX_BYTES = 1024 * 1024;
/** Exact first line Netscape-format cookie exports use. */
export const COOKIE_FILE_HEADER = "# Netscape HTTP Cookie File";
/** Rows for HttpOnly cookies start with this prefix instead of `#` comments. */
export const COOKIE_HTTPONLY_PREFIX = "#HttpOnly_";
/** The owner's exact friendly validation copy. */
export const COOKIE_INVALID_MESSAGE =
  "This doesn't look like a cookies.txt export — it should start with `# Netscape HTTP Cookie File`";
export const COOKIE_TOO_LARGE_MESSAGE = "This cookies.txt file is too large — keep it under 1 MB.";
export const COOKIE_EMPTY_MESSAGE = "That cookies.txt file has no cookies in it — export it again after signing in.";

export class CookieValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CookieValidationError";
  }
}

/**
 * Validate a plaintext Netscape cookie jar. Throws a friendly
 * {@link CookieValidationError} so the admin UI never shows a parser error.
 */
export function validateCookies(plaintext: string, byteLength = Buffer.byteLength(plaintext, "utf8")): void {
  if (byteLength > COOKIES_MAX_BYTES) throw new CookieValidationError(COOKIE_TOO_LARGE_MESSAGE);
  const lines = plaintext.split(/\r?\n/);
  const first = lines.find((line) => line.trim() !== "") ?? "";
  if (!first.startsWith(COOKIE_FILE_HEADER)) throw new CookieValidationError(COOKIE_INVALID_MESSAGE);
  let rows = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === "") continue;
    // Preserve the trailing tab and value whitespace: empty cookie values are valid.
    const row = line.trimStart();
    if (row.startsWith(COOKIE_HTTPONLY_PREFIX)) {
      validateRow(row.slice(COOKIE_HTTPONLY_PREFIX.length));
      rows += 1;
      continue;
    }
    if (trimmed.startsWith("#")) continue;
    validateRow(row);
    rows += 1;
  }
  if (rows === 0) throw new CookieValidationError(COOKIE_EMPTY_MESSAGE);
}

/** Netscape rows are tab-separated: domain, flag, path, secure, expiry, name, value. */
function validateRow(row: string): void {
  const fields = row.split("\t");
  if (fields.length !== 7) throw new CookieValidationError(COOKIE_INVALID_MESSAGE);
  const [domain, flag, cookiePath, secure, expiry, name] = fields;
  if (domain === undefined || domain === "") throw new CookieValidationError(COOKIE_INVALID_MESSAGE);
  if (flag !== "TRUE" && flag !== "FALSE") throw new CookieValidationError(COOKIE_INVALID_MESSAGE);
  if (cookiePath === undefined || !cookiePath.startsWith("/")) throw new CookieValidationError(COOKIE_INVALID_MESSAGE);
  if (secure !== "TRUE" && secure !== "FALSE") throw new CookieValidationError(COOKIE_INVALID_MESSAGE);
  if (expiry === undefined || !/^-?\d+$/.test(expiry)) throw new CookieValidationError(COOKIE_INVALID_MESSAGE);
  if (name === undefined || name === "") throw new CookieValidationError(COOKIE_INVALID_MESSAGE);
}

export interface CookieStatus {
  source: "none" | "uploaded" | "env";
  configured: boolean;
  readable: boolean;
  stale: boolean;
  lastSuccessAt: string | null;
  lastSuccessVideoId: string | null;
}

const EMPTY_STATUS: CookieStatus = {
  source: "none",
  configured: false,
  readable: false,
  stale: false,
  lastSuccessAt: null,
  lastSuccessVideoId: null,
};

interface StoredState {
  version: 1;
  /** AES-GCM ciphertext of the uploaded plaintext; null when none was uploaded. */
  enc: string | null;
  generation: number;
  stale: boolean;
  lastSuccessAt: string | null;
  lastSuccessVideoId: string | null;
  /** Generation for which the stale admin notification was already sent. */
  notifiedGeneration: number | null;
  /** Non-secret hash of the env cookie file, used only to detect a re-export. */
  envFingerprint: string | null;
}

const EMPTY_STATE: StoredState = {
  version: 1,
  enc: null,
  generation: 0,
  stale: false,
  lastSuccessAt: null,
  lastSuccessVideoId: null,
  notifiedGeneration: null,
  envFingerprint: null,
};

/** A credential snapshot tied to the generation an engine run actually used. */
export interface CookieSnapshot {
  generation: number;
  plaintext: string | null;
  source: CookieStatus["source"];
}

export interface CookieStoreDeps {
  dataDir: string;
  secretsKey: Buffer;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
}

/**
 * Encrypted, instance-local store for the operator's YouTube cookie jar.
 *
 * Every state read/write is serialized through one mutation chain, so an
 * upload, removal or env re-export cannot interleave with an in-flight
 * transcript outcome. Outcomes carry the generation their run used and are
 * ignored once the credentials have been replaced.
 */
export class CookieStore {
  readonly #dataDir: string;
  readonly #secretsKey: Buffer;
  readonly #env: NodeJS.ProcessEnv;
  readonly #now: () => Date;
  #state: StoredState | null = null;
  #mutex: Promise<unknown> = Promise.resolve();

  constructor(deps: CookieStoreDeps) {
    this.#dataDir = deps.dataDir;
    this.#secretsKey = deps.secretsKey;
    this.#env = deps.env ?? process.env;
    this.#now = deps.now ?? (() => new Date());
  }

  get file(): string {
    return path.join(this.#dataDir, "youtube", "cookies.json");
  }

  #envPath(): string | null {
    const value = this.#env.YOUTUBE_COOKIES_PATH?.trim();
    return value === undefined || value === "" ? null : value;
  }

  /** Serialize every state mutation and the initial load. */
  #mutate<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.#mutex.then(fn, fn);
    this.#mutex = run.catch(() => undefined);
    return run;
  }

  async #load(): Promise<StoredState> {
    if (this.#state !== null) return this.#state;
    try {
      const parsed: unknown = JSON.parse(await fs.readFile(this.file, "utf8"));
      if (typeof parsed !== "object" || parsed === null) throw new Error("invalid state");
      const record = parsed as Record<string, unknown>;
      this.#state = {
        version: 1,
        enc: typeof record.enc === "string" ? record.enc : null,
        generation: typeof record.generation === "number" ? record.generation : 0,
        stale: record.stale === true,
        lastSuccessAt: typeof record.lastSuccessAt === "string" ? record.lastSuccessAt : null,
        lastSuccessVideoId: typeof record.lastSuccessVideoId === "string" ? record.lastSuccessVideoId : null,
        notifiedGeneration: typeof record.notifiedGeneration === "number" ? record.notifiedGeneration : null,
        envFingerprint: typeof record.envFingerprint === "string" ? record.envFingerprint : null,
      };
    } catch {
      this.#state = { ...EMPTY_STATE };
    }
    return this.#state;
  }

  async #write(state: StoredState): Promise<void> {
    const dir = path.dirname(this.file);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const tmp = path.join(dir, `.cookies.${randomBytes(8).toString("hex")}.tmp`);
    try {
      await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600, flag: "wx" });
      await fs.rename(tmp, this.file);
    } catch (error) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw error;
    }
    this.#state = state;
  }

  /** Read the env file, or null when it is absent/unreadable/invalid. */
  async #readEnvFile(): Promise<{ plaintext: string; fingerprint: string } | null> {
    const envPath = this.#envPath();
    if (envPath === null) return null;
    try {
      const stats = await fs.stat(envPath);
      if (!stats.isFile() || stats.size === 0 || stats.size > COOKIES_MAX_BYTES) return null;
      const text = await fs.readFile(envPath, "utf8");
      validateCookies(text, stats.size);
      return { plaintext: text, fingerprint: createHash("sha256").update(text).digest("hex") };
    } catch {
      return null;
    }
  }

  /**
   * Refresh env-file bookkeeping: a changed (or freshly re-exported) file gets
   * a new generation and clears stale/last-success so the operator's re-export
   * takes effect without a restart.
   */
  async #refreshState(env?: { plaintext: string; fingerprint: string } | null): Promise<StoredState> {
    const state = await this.#load();
    if (this.#envPath() === null) return state;
    const current = env === undefined ? await this.#readEnvFile() : env;
    const fingerprint = current?.fingerprint ?? null;
    if (fingerprint === state.envFingerprint) return state;
    const next = {
      ...state,
      generation: state.generation + 1,
      stale: false,
      lastSuccessAt: null,
      lastSuccessVideoId: null,
      notifiedGeneration: null,
      envFingerprint: fingerprint,
    };
    await this.#write(next);
    return next;
  }

  async refresh(): Promise<CookieStatus> {
    return this.#mutate(async () => this.#statusOf(await this.#refreshState()));
  }

  async status(): Promise<CookieStatus> {
    return this.refresh();
  }

  #statusOf(state: StoredState): CookieStatus {
    const envPath = this.#envPath();
    if (envPath !== null) {
      return {
        source: "env",
        configured: true,
        readable: state.envFingerprint !== null,
        stale: state.stale,
        lastSuccessAt: state.lastSuccessAt,
        lastSuccessVideoId: state.lastSuccessVideoId,
      };
    }
    if (state.enc === null) return { ...EMPTY_STATUS };
    return {
      source: "uploaded",
      configured: true,
      // Corrupt ciphertext must read as unreadable, not Configured.
      readable: this.#decryptable(state),
      stale: state.stale,
      lastSuccessAt: state.lastSuccessAt,
      lastSuccessVideoId: state.lastSuccessVideoId,
    };
  }

  #decryptable(state: StoredState): boolean {
    if (state.enc === null) return false;
    try {
      decryptSecret(this.#secretsKey, state.enc);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Snapshot the current credentials under the mutation lock, decrypting the
   * uploaded master only in memory and only for a signed-in run.
   */
  async snapshot(): Promise<CookieSnapshot> {
    return this.#mutate(async () => {
      const envPath = this.#envPath();
      const env = envPath === null ? null : await this.#readEnvFile();
      const state = await this.#refreshState(env);
      if (envPath !== null) {
        return { generation: state.generation, plaintext: env?.plaintext ?? null, source: "env" };
      }
      if (state.enc === null) return { generation: state.generation, plaintext: null, source: "none" };
      try {
        return {
          generation: state.generation,
          plaintext: decryptSecret(this.#secretsKey, state.enc),
          source: "uploaded",
        };
      } catch {
        return { generation: state.generation, plaintext: null, source: "uploaded" };
      }
    });
  }

  /** Encrypt and store an uploaded jar, resetting stale and last-success. */
  async upload(plaintext: string): Promise<void> {
    validateCookies(plaintext);
    return this.#mutate(async () => {
      const state = await this.#load();
      await this.#write({
        ...state,
        enc: encryptSecret(this.#secretsKey, plaintext),
        generation: state.generation + 1,
        stale: false,
        lastSuccessAt: null,
        lastSuccessVideoId: null,
        notifiedGeneration: null,
      });
    });
  }

  /** Remove only the uploaded jar; an env-provided path is operator-owned. */
  async remove(): Promise<boolean> {
    return this.#mutate(async () => {
      const state = await this.#load();
      if (state.enc === null) return false;
      await this.#write({
        ...state,
        enc: null,
        generation: state.generation + 1,
        stale: false,
        lastSuccessAt: null,
        lastSuccessVideoId: null,
        notifiedGeneration: null,
      });
      return true;
    });
  }

  /** Record a signed-in success only when the run's generation is still current. */
  async recordSuccess(videoId: string, generation: number): Promise<boolean> {
    return this.#mutate(async () => {
      const state = await this.#refreshState();
      if (generation !== state.generation) return false;
      await this.#write({
        ...state,
        stale: false,
        lastSuccessAt: this.#now().toISOString(),
        lastSuccessVideoId: videoId,
        notifiedGeneration: null,
      });
      return true;
    });
  }

  /**
   * Flip to stale for the run's generation. Returns true only for the first
   * transition of that generation, so the admin is notified once per
   * credential generation and never for a superseded run.
   */
  async markStale(generation: number): Promise<boolean> {
    return this.#mutate(async () => {
      const state = await this.#refreshState();
      if (generation !== state.generation) return false;
      if (state.stale && state.notifiedGeneration === state.generation) return false;
      await this.#write({ ...state, stale: true, notifiedGeneration: state.generation });
      return true;
    });
  }

  /**
   * Copy the plaintext to a private per-run file (mode 0600, exclusive create,
   * random name) and delete it on success, error or abort. `fn` receives null
   * when no readable jar exists.
   */
  async withRunCopy<T>(fn: (file: string | null, generation: number) => Promise<T>): Promise<T> {
    const snapshot = await this.snapshot();
    if (snapshot.plaintext === null) return fn(null, snapshot.generation);
    const dir = await fs.mkdtemp(path.join(tmpdir(), "studium-ytdlp-"));
    const file = path.join(dir, `${randomBytes(8).toString("hex")}.cookies.txt`);
    try {
      await fs.writeFile(file, snapshot.plaintext, { mode: 0o600, flag: "wx" });
      return await fn(file, snapshot.generation);
    } finally {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}
