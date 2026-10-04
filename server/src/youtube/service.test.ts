import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deriveKey } from "../db/secret.js";
import type { SafeFetchResponse } from "../ingest/safe-fetch.js";
import type { CommandResult, RunCommandOptions } from "./engine.js";
import { classifyFailure, selectCaptionTrack, YoutubeService } from "./service.js";

const HEADER = "# Netscape HTTP Cookie File";
const COOKIE_FILE = `${HEADER}\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tvalue\n`;
const JSON3 = JSON.stringify({
  events: [
    { tStartMs: 0, dDurationMs: 1000, segs: [{ utf8: "Hello from yt-dlp." }] },
    { tStartMs: 1500, dDurationMs: 1000, segs: [{ utf8: "Second line." }] },
  ],
});

function metadataStdout(captionKey = "en-orig", kind: "subtitles" | "automatic_captions" = "automatic_captions") {
  return JSON.stringify({
    title: "A Talk",
    uploader: "A Channel",
    subtitles:
      kind === "subtitles"
        ? { [captionKey]: [{ url: "https://www.youtube.com/api/timedtext?x=1", ext: "json3" }] }
        : {},
    automatic_captions:
      kind === "automatic_captions"
        ? { [captionKey]: [{ url: "https://www.youtube.com/api/timedtext?x=2", ext: "json3" }] }
        : {},
  });
}

function ok(stdout: string): CommandResult {
  return { code: 0, stdout, stderr: "", timedOut: false };
}

function fail(stderr: string): CommandResult {
  return { code: 1, stdout: "", stderr, timedOut: false };
}

function fetchResponse(bytes: string, contentType = "application/json"): SafeFetchResponse {
  return {
    url: "https://www.youtube.com/x",
    status: 200,
    ok: true,
    headers: new Headers(),
    contentType,
    bytes: new TextEncoder().encode(bytes),
  };
}

let dataDir: string;
let env: NodeJS.ProcessEnv;

beforeEach(async () => {
  dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "studium-youtube-"));
  env = {};
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(dataDir, { recursive: true, force: true });
});

interface RunCall {
  command: string;
  args: string[];
  options: RunCommandOptions;
  at: number;
}

function makeService(overrides: Partial<ConstructorParameters<typeof YoutubeService>[0]> = {}) {
  const calls: RunCall[] = [];
  let clock = 0;
  const runCommand = vi.fn(
    async (command: string, args: string[], options: RunCommandOptions): Promise<CommandResult> => {
      if (args.includes("--version")) return ok("2026.08.19\n");
      calls.push({ command, args, options, at: clock });
      return ok(metadataStdout());
    },
  );
  const safeFetchImpl = vi.fn(async (url: string): Promise<SafeFetchResponse> => {
    if (url.includes("/api/timedtext")) return fetchResponse(JSON3);
    if (url.includes("oembed")) return fetchResponse(JSON.stringify({ title: "A Talk", author_name: "A Channel" }));
    return fetchResponse("jpeg", "image/jpeg");
  });
  const service = new YoutubeService({
    dataDir,
    secretsKey: deriveKey(Buffer.alloc(32, 3), "studium-secrets-v1"),
    env,
    platform: "linux",
    arch: "x64",
    pathExists: async () => true,
    runCommand,
    safeFetchImpl: safeFetchImpl as unknown as typeof import("../ingest/safe-fetch.js").safeFetch,
    sleep: async (ms) => {
      clock += ms;
    },
    now: () => clock,
    startSpacingMs: 2000,
    retryDelayMs: 5000,
    ...overrides,
  });
  return { service, runCommand, safeFetchImpl, calls, now: () => clock };
}

describe("classifyFailure", () => {
  it("treats a bot wall and rate limits as blocked, never stale", () => {
    expect(classifyFailure("ERROR: Sign in to confirm you're not a bot")).toBe("blocked");
    expect(classifyFailure("ERROR: HTTP Error 429: Too Many Requests")).toBe("blocked");
  });

  it("only explicit expired/invalid-cookie evidence is stale", () => {
    expect(classifyFailure("ERROR: The provided cookies are no longer valid")).toBe("stale-cookie");
    expect(classifyFailure("ERROR: cookie file is expired")).toBe("stale-cookie");
  });

  it("keeps disabled, no-captions and unavailable distinct", () => {
    expect(classifyFailure("ERROR: Captions are disabled by the uploader")).toBe("disabled");
    expect(classifyFailure("ERROR: There are no subtitles for this video")).toBe("no-captions");
    expect(classifyFailure("ERROR: This video is unavailable")).toBe("unavailable");
  });
});

describe("selectCaptionTrack", () => {
  const track = (url: string) => [{ url, ext: "json3" }];

  it("prefers curated English over English auto captions", () => {
    const picked = selectCaptionTrack({
      subtitles: { en: track("https://www.youtube.com/api/timedtext?curated=1") },
      automatic_captions: { en: track("https://www.youtube.com/api/timedtext?auto=1") },
    });
    expect(picked).toMatchObject({ lang: "en", origin: "curated" });
  });

  it("prefers an explicit original track over an arbitrary auto-translated one", () => {
    const picked = selectCaptionTrack({
      automatic_captions: {
        fr: track("https://www.youtube.com/api/timedtext?fr=1"),
        "de-orig": track("https://www.youtube.com/api/timedtext?de-orig=1"),
      },
    });
    expect(picked).toMatchObject({ lang: "de-orig", origin: "fallback" });
  });

  it("ignores non-json3 tracks instead of pretending the video has no captions", () => {
    expect(selectCaptionTrack({ subtitles: { en: [{ url: "https://x", ext: "vtt" }] } })).toBeNull();
  });
});

describe("YoutubeService status", () => {
  it("reports basic with no engine and no cookies", async () => {
    const { service } = makeService({ pathExists: async () => false, runCommand: async () => fail("not found") });
    const status = await service.status();
    expect(status.mode).toBe("basic");
    expect(status.engine).toMatchObject({ state: "missing", platformSupported: true, nodePresent: true });
    expect(status.cookies.configured).toBe(false);
  });

  it("finds a managed binary on disk with no injected pathExists", async () => {
    const target = path.join(dataDir, "bin", "yt-dlp");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "#!/bin/sh\n", { mode: 0o755 });
    const service = new YoutubeService({
      dataDir,
      secretsKey: deriveKey(Buffer.alloc(32, 3), "studium-secrets-v1"),
      env,
      platform: "linux",
      arch: "x64",
      runCommand: async (_command, args) => (args.includes("--version") ? ok("2026.08.19\n") : fail("unused")),
      safeFetchImpl: (async () => fetchResponse("{}")) as unknown as typeof import("../ingest/safe-fetch.js").safeFetch,
    });
    const status = await service.status();
    expect(status.engine).toMatchObject({ state: "found", source: "managed", version: "2026.08.19" });
    expect(status.mode).toBe("improved");
  });

  it("falls back to a managed binary when YTDLP_PATH is invalid, and says so", async () => {
    const target = path.join(dataDir, "bin", "yt-dlp");
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "#!/bin/sh\n", { mode: 0o755 });
    const invalid = path.join(dataDir, "missing-yt-dlp");
    env.YTDLP_PATH = invalid;
    const { service } = makeService({
      runCommand: async (command, args) =>
        command === invalid ? fail("no such file") : args.includes("--version") ? ok("2026.08.19\n") : fail("unused"),
    });
    const status = await service.status();
    expect(status.engine).toMatchObject({ state: "found", source: "managed", envOverrideInvalid: true });
    expect(status.mode).toBe("improved");
  });

  it("stays basic (never claims improved) when the override and fallbacks are all missing", async () => {
    env.YTDLP_PATH = path.join(dataDir, "missing-yt-dlp");
    const { service } = makeService({ pathExists: async () => false, runCommand: async () => fail("not found") });
    const status = await service.status();
    expect(status.engine).toMatchObject({ state: "missing", envOverrideInvalid: true });
    expect(status.mode).toBe("basic");
  });

  it("reports signed-in when readable cookies are configured", async () => {
    const envFile = path.join(dataDir, "cookies.txt");
    await fs.writeFile(envFile, COOKIE_FILE, { mode: 0o600 });
    env.YOUTUBE_COOKIES_PATH = envFile;
    const { service } = makeService();
    const status = await service.status();
    expect(status.mode).toBe("signed-in");
    expect(status.cookies).toMatchObject({ source: "env", configured: true, readable: true, stale: false });
  });

  it("reports not available on unsupported platforms", async () => {
    const { service } = makeService({
      platform: "win32",
      pathExists: async () => false,
      runCommand: async () => fail(""),
    });
    const status = await service.status();
    expect(status.engine.platformSupported).toBe(false);
    expect(status.engine.asset).toBeNull();
  });
});

describe("YoutubeService.transcript", () => {
  it("returns engine-missing without a binary", async () => {
    const { service } = makeService({ pathExists: async () => false, runCommand: async () => fail("not found") });
    expect(await service.transcript("dQw4w9WgXcQ")).toEqual({ ok: false, kind: "engine-missing", retryable: false });
  });

  it("normalizes the original-English auto track through json3 (fractional seconds kept)", async () => {
    const { service } = makeService();
    const attempt = await service.transcript("dQw4w9WgXcQ");
    expect(attempt).toMatchObject({
      ok: true,
      title: "A Talk",
      author: "A Channel",
      segments: [
        { text: "Hello from yt-dlp.", offset: 0, duration: 1 },
        { text: "Second line.", offset: 1.5, duration: 1 },
      ],
    });
  });

  it("runs anonymous without decrypting or copying credentials", async () => {
    const { service, calls } = makeService();
    await service.uploadCookies(COOKIE_FILE);
    const before = (await fs.readdir(os.tmpdir())).filter((name) => name.startsWith("studium-ytdlp-"));
    const attempt = await service.transcript("dQw4w9WgXcQ");
    expect(attempt.ok).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(call.args).not.toContain("--cookies");
    }
    // No credential copy directory is left behind for an anonymous run.
    const after = (await fs.readdir(os.tmpdir())).filter((name) => name.startsWith("studium-ytdlp-"));
    expect(after).toEqual(before);
  });

  it("passes a private per-run copy only for a signed-in run, and deletes it", async () => {
    const { service, calls } = makeService();
    await service.uploadCookies(COOKIE_FILE);
    const attempt = await service.transcript("dQw4w9WgXcQ", { mode: "signed-in" });
    expect(attempt.ok).toBe(true);
    expect(calls).toHaveLength(1);
    const args = calls[0]?.args ?? [];
    const index = args.indexOf("--cookies");
    const copy = args[index + 1] as string;
    expect(index).toBeGreaterThan(-1);
    expect(copy).not.toBe(path.join(dataDir, "youtube", "cookies.json"));
    expect(copy.startsWith(os.tmpdir())).toBe(true);
    await expect(fs.stat(copy)).rejects.toThrow();
    const status = await service.status();
    expect(status.cookies).toMatchObject({ lastSuccessVideoId: "dQw4w9WgXcQ", stale: false });
    expect(status.cookies.lastSuccessAt).not.toBeNull();
  });

  it("keeps a bot wall with valid cookies blocked, not stale", async () => {
    const { service } = makeService({
      runCommand: async (_command, args) =>
        args.includes("--version") ? ok("2026.08.19\n") : fail("ERROR: Sign in to confirm you're not a bot"),
    });
    await service.uploadCookies(COOKIE_FILE);
    const attempt = await service.transcript("dQw4w9WgXcQ", { mode: "signed-in" });
    expect(attempt).toMatchObject({ ok: false, kind: "blocked", retryable: true });
    expect((await service.status()).cookies.stale).toBe(false);
  });

  it("marks stale and notifies once for explicit invalid-cookie evidence", async () => {
    const notifyAdmins = vi.fn(async () => undefined);
    const { service } = makeService({
      notifier: { notifyAdmins },
      runCommand: async (_command, args) =>
        args.includes("--version") ? ok("2026.08.19\n") : fail("ERROR: The provided cookies are no longer valid"),
    });
    await service.uploadCookies(COOKIE_FILE);
    const first = await service.transcript("dQw4w9WgXcQ", { mode: "signed-in" });
    const second = await service.transcript("aaaaaaaaaaa", { mode: "signed-in" });
    expect(first).toMatchObject({ ok: false, kind: "stale-cookie", retryable: false });
    expect(second).toMatchObject({ ok: false, kind: "stale-cookie" });
    expect(notifyAdmins).toHaveBeenCalledTimes(1);
    const status = await service.status();
    expect(status.cookies.stale).toBe(true);
    expect(status.modeLabel).toContain("sign-in expired");
  });

  it("does not retry a non-retryable outcome", async () => {
    let transcriptRuns = 0;
    const { service } = makeService({
      runCommand: async (_command, args) => {
        if (args.includes("--version")) return ok("2026.08.19\n");
        transcriptRuns += 1;
        return ok(JSON.stringify({ subtitles: {}, automatic_captions: {} }));
      },
    });
    const attempt = await service.transcript("dQw4w9WgXcQ");
    expect(attempt).toMatchObject({ ok: false, kind: "no-captions", retryable: false });
    expect(transcriptRuns).toBe(1);
  });

  it("treats an advertised track that yields no json3 segments as retryable extraction-error", async () => {
    const { service } = makeService({
      safeFetchImpl: (async () =>
        fetchResponse(JSON.stringify({ events: [] }))) as unknown as typeof import("../ingest/safe-fetch.js").safeFetch,
      runCommand: async (_command, args) => (args.includes("--version") ? ok("2026.08.19\n") : ok(metadataStdout())),
    });
    const attempt = await service.transcript("dQw4w9WgXcQ");
    expect(attempt).toMatchObject({ ok: false, kind: "extraction-error", retryable: true });
  });

  it("retries a transient failure once after the retry delay", async () => {
    let runs = 0;
    const times: number[] = [];
    const { service, now } = makeService({
      runCommand: async (_command, args) => {
        if (args.includes("--version")) return ok("2026.08.19\n");
        runs += 1;
        times.push(now());
        return runs <= 1 ? fail("ERROR: nsig extraction failed") : ok(metadataStdout());
      },
    });
    const attempt = await service.transcript("dQw4w9WgXcQ");
    expect(attempt.ok).toBe(true);
    expect(runs).toBe(2);
    expect((times[1] as number) - (times[0] as number)).toBeGreaterThanOrEqual(5000);
  });

  it("enforces spacing at every subprocess start, including retries and the next video", async () => {
    const times: number[] = [];
    let runs = 0;
    const { service, now } = makeService({
      runCommand: async (_command, args) => {
        if (args.includes("--version")) return ok("2026.08.19\n");
        times.push(now());
        runs += 1;
        return runs === 1 ? fail("ERROR: nsig extraction failed") : ok(metadataStdout());
      },
    });
    await Promise.all([service.transcript("dQw4w9WgXcQ"), service.transcript("aaaaaaaaaaa")]);
    // attempt 1 (fail), attempt 2 (retry), then the queued second video.
    expect(times).toHaveLength(3);
    for (let index = 1; index < times.length; index++) {
      expect((times[index] as number) - (times[index - 1] as number)).toBeGreaterThanOrEqual(2000);
    }
  });

  it("aborts while queued without starting a subprocess", async () => {
    const controller = new AbortController();
    const urls: string[] = [];
    const { service } = makeService({
      runCommand: async (_command, args) => {
        if (args.includes("--version")) return ok("2026.08.19\n");
        urls.push(args.find((arg) => arg.includes("youtube.com/watch")) ?? "");
        return ok(metadataStdout());
      },
    });
    const first = service.transcript("dQw4w9WgXcQ");
    const second = service.transcript("aaaaaaaaaaa", { signal: controller.signal });
    controller.abort();
    await expect(second).rejects.toMatchObject({ name: "AbortError" });
    await first;
    expect(urls.some((url) => url.includes("aaaaaaaaaaa"))).toBe(false);
    expect(urls.some((url) => url.includes("dQw4w9WgXcQ"))).toBe(true);
  });
});
