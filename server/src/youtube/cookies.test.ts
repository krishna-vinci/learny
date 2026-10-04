import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { deriveKey } from "../db/secret.js";
import { CookieStore, CookieValidationError, validateCookies } from "./cookies.js";

const HEADER = "# Netscape HTTP Cookie File";
const VALID = `${HEADER}\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret-value\n`;

let dataDir: string;
let store: CookieStore;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-cookies-"));
  env = {};
  store = new CookieStore({ dataDir, secretsKey: deriveKey(Buffer.alloc(32, 7), "studium-secrets-v1"), env });
});

afterEach(async () => {
  await fs.rm(dataDir, { recursive: true, force: true });
});

describe("validateCookies", () => {
  it("accepts Netscape rows whose cookie value is empty", () => {
    expect(() => validateCookies(`${HEADER}\n.youtube.com\tTRUE\t/\tTRUE\t0\tEMPTY\t\n`)).not.toThrow();
  });
  it("accepts a Netscape export including #HttpOnly_ rows", () => {
    expect(() => validateCookies(VALID)).not.toThrow();
    expect(() => validateCookies(`${HEADER}\n#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tv\n`)).not.toThrow();
  });

  it("rejects a non-export file with the owner's friendly copy", () => {
    expect(() => validateCookies("hello")).toThrowError(CookieValidationError);
    expect(() => validateCookies("hello")).toThrow(
      "This doesn't look like a cookies.txt export — it should start with `# Netscape HTTP Cookie File`",
    );
  });

  it("requires the header to be the first non-empty line, not a substring", () => {
    expect(() => validateCookies(`# unrelated comment\n${HEADER}\n`)).toThrow(CookieValidationError);
    expect(() => validateCookies(`not before ${HEADER} text\n`)).toThrow(CookieValidationError);
  });

  it("rejects an export with no cookie rows", () => {
    expect(() => validateCookies(`${HEADER}\n`)).toThrow(/no cookies/);
  });

  it("rejects malformed rows (field count, flags, path, expiry, domain)", () => {
    const rows = [
      ".youtube.com\tTRUE\t/\tTRUE\t0\tSID", // six fields
      ".youtube.com\tYES\t/\tTRUE\t0\tSID\tv", // bad flag
      ".youtube.com\tTRUE\tcookie.txt\tTRUE\t0\tSID\tv", // bad path
      ".youtube.com\tTRUE\t/\tMAYBE\t0\tSID\tv", // bad secure flag
      ".youtube.com\tTRUE\t/\tTRUE\tsoon\tSID\tv", // bad expiry
      "\tTRUE\t/\tTRUE\t0\tSID\tv", // missing domain
      ".youtube.com\tTRUE\t/\tTRUE\t0\t\tv", // missing name
    ];
    for (const row of rows) expect(() => validateCookies(`${HEADER}\n${row}\n`)).toThrow(CookieValidationError);
  });

  it("rejects a file over the 1 MiB cap", () => {
    expect(() => validateCookies(`${HEADER}\n`, 1024 * 1024 + 1)).toThrow(/too large/);
  });
});

describe("CookieStore", () => {
  it("stores an upload encrypted and never returns the plaintext", async () => {
    await store.upload(VALID);
    const onDisk = await fs.readFile(store.file, "utf8");
    expect(onDisk).not.toContain("secret-value");
    expect(onDisk).not.toContain("SID");
    const status = await store.status();
    expect(status).toMatchObject({ source: "uploaded", configured: true, readable: true, stale: false });
    expect(JSON.stringify(status)).not.toContain("secret-value");
  });

  it("reports unreadable rather than Configured when the ciphertext is corrupt", async () => {
    await store.upload(VALID);
    const state = JSON.parse(await fs.readFile(store.file, "utf8")) as { enc: string };
    state.enc = `${state.enc.slice(0, -4)}AAAA`;
    await fs.writeFile(store.file, JSON.stringify(state));
    const fresh = new CookieStore({
      dataDir,
      secretsKey: deriveKey(Buffer.alloc(32, 7), "studium-secrets-v1"),
      env,
    });
    const status = await fresh.status();
    expect(status).toMatchObject({ source: "uploaded", configured: true, readable: false });
    expect((await fresh.snapshot()).plaintext).toBeNull();
  });

  it("decrypts into a per-run copy that is deleted afterwards", async () => {
    await store.upload(VALID);
    let seen: string | null = null;
    await store.withRunCopy(async (file, generation) => {
      seen = file;
      expect(generation).toBe(1);
      expect(file).not.toBeNull();
      const text = await fs.readFile(file as string, "utf8");
      expect(text).toContain("secret-value");
      expect(((await fs.stat(file as string)).mode & 0o777).toString(8)).toBe("600");
    });
    await expect(fs.stat(seen as unknown as string)).rejects.toThrow();
    await store.withRunCopy(async (file) => {
      expect(await fs.readFile(file as string, "utf8")).toContain("secret-value");
    });
  });

  it("deletes the per-run copy when the run throws", async () => {
    await store.upload(VALID);
    let seen: string | null = null;
    await expect(
      store.withRunCopy(async (file) => {
        seen = file;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    await expect(fs.stat(seen as unknown as string)).rejects.toThrow();
  });

  it("flips stale once per generation and ignores outcomes from replaced credentials", async () => {
    await store.upload(VALID);
    expect(await store.markStale(1)).toBe(true);
    expect(await store.markStale(1)).toBe(false);
    expect((await store.status()).stale).toBe(true);
    expect(await store.recordSuccess("video-id", 1)).toBe(true);
    const status = await store.status();
    expect(status.stale).toBe(false);
    expect(status.lastSuccessVideoId).toBe("video-id");

    // Replacing the jar opens a new generation: old outcomes are ignored.
    await store.upload(VALID);
    expect(await store.recordSuccess("stale-run", 1)).toBe(false);
    expect(await store.markStale(1)).toBe(false);
    const after = await store.status();
    expect(after.lastSuccessVideoId).toBeNull();
    expect(after.stale).toBe(false);
    expect(await store.markStale(2)).toBe(true);
  });

  it("clears last success, stale and notification state on upload and remove", async () => {
    await store.upload(VALID);
    await store.markStale(1);
    await store.recordSuccess("video", 1);
    expect((await store.status()).lastSuccessVideoId).toBe("video");
    await store.upload(VALID);
    const afterUpload = await store.status();
    expect(afterUpload).toMatchObject({ stale: false, lastSuccessAt: null, lastSuccessVideoId: null });
    expect(await store.remove()).toBe(true);
    expect(await store.status()).toMatchObject({ source: "none", configured: false });
    expect(await store.remove()).toBe(false);
  });

  it("ignores a pending run's outcome when the jar was removed mid-run", async () => {
    await store.upload(VALID);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const run = store.withRunCopy(async (_file, generation) => {
      await gate;
      return store.recordSuccess("in-flight", generation);
    });
    await store.remove();
    release();
    expect(await run).toBe(false);
    expect((await store.status()).lastSuccessVideoId).toBeNull();
  });

  it("prefers an env-provided cookie file and never rewrites it", async () => {
    const envFile = path.join(dataDir, "operator-cookies.txt");
    await fs.writeFile(envFile, VALID, { mode: 0o600 });
    env.YOUTUBE_COOKIES_PATH = envFile;
    const before = await fs.readFile(envFile, "utf8");
    const status = await store.status();
    expect(status).toMatchObject({ source: "env", configured: true, readable: true });
    await store.withRunCopy(async (file) => {
      expect(file).not.toBe(envFile);
      await fs.writeFile(file as string, "rewritten by yt-dlp\n");
    });
    expect(await fs.readFile(envFile, "utf8")).toBe(before);
    expect(await store.remove()).toBe(false);
  });

  it("treats an env re-export as a new generation and clears stale", async () => {
    const envFile = path.join(dataDir, "operator-cookies.txt");
    await fs.writeFile(envFile, VALID, { mode: 0o600 });
    env.YOUTUBE_COOKIES_PATH = envFile;
    // The env file appearing is generation 1.
    await store.status();
    expect(await store.markStale(1)).toBe(true);
    expect((await store.status()).stale).toBe(true);
    const reExported = `${HEADER}\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tfresh-value\n`;
    await fs.writeFile(envFile, reExported, { mode: 0o600 });
    const refreshed = await store.status();
    expect(refreshed).toMatchObject({ stale: false, lastSuccessAt: null, lastSuccessVideoId: null });
    // The previous stale notification does not carry over to the new generation.
    expect(await store.markStale(1)).toBe(false);
    const snapshot = await store.snapshot();
    expect(snapshot.plaintext).toContain("fresh-value");
    // The fingerprint is non-secret: it never contains cookie content.
    const persisted = await fs.readFile(store.file, "utf8");
    expect(persisted).not.toContain("fresh-value");
  });

  it("detects an env replacement before recording an older run's outcome", async () => {
    const envFile = path.join(dataDir, "operator-cookies.txt");
    await fs.writeFile(envFile, VALID, { mode: 0o600 });
    env.YOUTUBE_COOKIES_PATH = envFile;
    await store.status();
    const old = await store.snapshot();
    await fs.writeFile(envFile, VALID.replace("secret-value", "replacement-value"), { mode: 0o600 });
    expect(await store.markStale(old.generation)).toBe(false);
    expect(await store.recordSuccess("old-run", old.generation)).toBe(false);
    const status = await store.status();
    expect(status).toMatchObject({ stale: false, lastSuccessAt: null, lastSuccessVideoId: null });
    expect((await store.snapshot()).generation).toBeGreaterThan(old.generation);
  });

  it("degrades to unreadable when the env path is missing", async () => {
    env.YOUTUBE_COOKIES_PATH = path.join(dataDir, "nope.txt");
    const status = await store.status();
    expect(status).toMatchObject({ source: "env", configured: true, readable: false });
    await store.withRunCopy(async (file) => {
      expect(file).toBeNull();
    });
  });
});
