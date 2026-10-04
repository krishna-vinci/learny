import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fauxAssistantMessage, fauxProvider, fauxText } from "@earendil-works/pi-ai/providers/faux";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createModelRuntime } from "../agent/models.js";
import { EventHub } from "../events.js";
import { readSource, writeSource } from "../ingest/library.js";
import type { Extracted } from "../ingest/types.js";
import { McpManager } from "../mcp/bridge.js";
import { ensureRepo } from "../tree/git.js";
import { initStudyTree } from "../tree/init.js";
import { FileLocks } from "../tree/lock.js";
import type { YoutubeTranscriptEngine } from "../youtube/types.js";
import { createIngestJob } from "./ingest-job.js";

vi.mock("youtube-transcript-plus", () => ({
  fetchTranscript: vi.fn(async () => {
    throw new Error("ERROR: Sign in to confirm you're not a bot");
  }),
}));

vi.mock("../ingest/safe-fetch.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ingest/safe-fetch.js")>()),
  safeFetch: vi.fn(async () => {
    throw new Error("offline");
  }),
}));

const BLOCKED_COPY =
  "YouTube blocked the transcript for this video — try again later, or set up YouTube sign-in in Settings";

function blockedVideo(overrides: Partial<Extracted> = {}): Extracted {
  return {
    title: "A Blocked Talk",
    authors: ["A Channel"],
    markdown: "",
    pages: null,
    parseTier: "basic",
    warning: BLOCKED_COPY,
    transcriptStatus: "blocked",
    unreadable: true,
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    originalExt: null,
    ...overrides,
  };
}

function blockedEngine(): YoutubeTranscriptEngine {
  return {
    hasCredentials: () => false,
    transcript: vi.fn(async () => ({ ok: false as const, kind: "blocked" as const, retryable: true })),
    metadata: vi.fn(async () => ({ title: null, author: null, thumbnail: null })),
  };
}

async function fauxRuntime() {
  const runtime = await createModelRuntime();
  const faux = fauxProvider({ provider: "faux", models: [{ id: "echo" }] });
  runtime.registerNativeProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage(fauxText("Summarized."))]);
  return runtime;
}

function successEngine(): YoutubeTranscriptEngine {
  return {
    hasCredentials: () => false,
    transcript: vi.fn(async () => ({
      ok: true as const,
      segments: [{ text: "Recovered transcript line.", offset: 843.9, duration: 2 }],
    })),
    metadata: vi.fn(async () => ({ title: null, author: null, thumbnail: null })),
  };
}

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-ingest-retry-"));
  await initStudyTree(root);
  await ensureRepo(root);
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

async function runRetry(sourceId: string) {
  const hub = new EventHub();
  const job = createIngestJob({
    root,
    locks: new FileLocks(),
    mcp: {} as McpManager,
    runtime: {} as ModelRuntime,
    hub,
    youtube: blockedEngine(),
  });
  return job(
    { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", set: null, retrySourceId: sourceId },
    { signal: new AbortController().signal, progress: () => undefined, addUsage: () => undefined },
  );
}

async function runRetryWith(sourceId: string, url: string, engine: YoutubeTranscriptEngine, runtime: ModelRuntime) {
  const job = createIngestJob({
    root,
    locks: new FileLocks(),
    mcp: new McpManager([]),
    runtime,
    hub: new EventHub(),
    youtube: engine,
  });
  return job(
    { url, set: null, retrySourceId: sourceId },
    { signal: new AbortController().signal, progress: () => undefined, addUsage: () => undefined },
  );
}

describe("ingest job transcript retry", () => {
  it("keeps the source id and updates the warning in place when the retry is still blocked", async () => {
    const written = await writeSource(root, blockedVideo());
    const before = await readSource(root, written.id);
    const result = await runRetry(written.id);
    const after = await readSource(root, written.id);

    expect(result?.sourceId).toBe(written.id);
    expect(result?.warning).toBe(BLOCKED_COPY);
    expect(result?.transcriptStatus).toBe("blocked");
    expect(after?.source.id).toBe(written.id);
    expect(after?.source.url).toBe(before?.source.url);
    expect(after?.source.transcriptStatus).toBe("blocked");
    // No readable prose was fabricated and the placeholder body survives.
    expect(after?.parsedFiles).toEqual([]);
    expect(after?.body).toContain("This source is embedded for watching only.");
  });

  it("refuses to retry a source that is not blocked or unavailable", async () => {
    const written = await writeSource(root, blockedVideo({ transcriptStatus: "disabled" }));
    await expect(runRetry(written.id)).rejects.toThrow(/retryable transcript/);
  });

  it("routes a first-time YouTube add through the same ladder with no transcript", async () => {
    const hub = new EventHub();
    const job = createIngestJob({
      root,
      locks: new FileLocks(),
      mcp: {} as McpManager,
      runtime: {} as ModelRuntime,
      hub,
      youtube: blockedEngine(),
    });
    const result = await job(
      { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", set: null },
      { signal: new AbortController().signal, progress: () => undefined, addUsage: () => undefined },
    );
    expect(result?.sourceId).toBeTruthy();
    const view = await readSource(root, result?.sourceId as string);
    expect(view?.source.type).toBe("video");
    expect(view?.source.warning).toBe(BLOCKED_COPY);
    expect(view?.source.transcriptStatus).toBe("blocked");
    expect(view?.parsedFiles).toEqual([]);
  });

  it("rejects a retry whose supplied URL names a different video", async () => {
    const written = await writeSource(root, blockedVideo());
    const runtime = await fauxRuntime();
    await expect(
      runRetryWith(written.id, "https://www.youtube.com/watch?v=aaaaaaaaaaa", blockedEngine(), runtime),
    ).rejects.toThrow(/does not match/);
    const view = await readSource(root, written.id);
    expect(view?.source.transcriptStatus).toBe("blocked");
  });

  it("refreshes the warning and body when the new outcome is no-captions", async () => {
    const written = await writeSource(root, blockedVideo());
    const noCaptions: YoutubeTranscriptEngine = {
      hasCredentials: () => false,
      transcript: vi.fn(async () => ({ ok: false as const, kind: "no-captions" as const, retryable: false })),
      metadata: vi.fn(async () => ({ title: null, author: null, thumbnail: null })),
    };
    const runtime = await fauxRuntime();
    const result = await runRetryWith(written.id, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", noCaptions, runtime);
    const view = await readSource(root, written.id);
    expect(result?.transcriptStatus).toBe("no-captions");
    expect(view?.source.transcriptStatus).toBe("no-captions");
    expect(view?.source.warning).toBe("This video has no captions");
    // The old blocked warning must not linger in the body.
    expect(view?.body).toContain("This video has no captions");
    expect(view?.body).not.toContain("YouTube blocked the transcript");
  });

  it("keeps the source id and set links and writes timestamped parsed text on success", async () => {
    const written = await writeSource(root, blockedVideo());
    await fs.mkdir(path.join(root, "algebra"), { recursive: true });
    await fs.writeFile(path.join(root, "algebra/PLAN.md"), `---\nsources:\n  - ${written.id}\n---\n`);
    const before = await readSource(root, written.id);
    const runtime = await fauxRuntime();
    const result = await runRetryWith(
      written.id,
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      successEngine(),
      runtime,
    );
    const view = await readSource(root, written.id);
    expect(result?.sourceId).toBe(written.id);
    expect(view?.source.id).toBe(written.id);
    expect(view?.source.addedAt).toBe(before?.source.addedAt);
    expect(view?.source.url).toBe(before?.source.url);
    expect(view?.source.sets).toContain("algebra");
    expect(view?.source.parseTier).toBe("transcript");
    expect(view?.source.transcriptStatus).toBeNull();
    expect(view?.source.warning).toBeNull();
    const parsed = await fs.readFile(path.join(root, "library", written.id, view?.parsedFiles[0] as string), "utf8");
    expect(parsed).toContain("Recovered transcript line.");
    expect(parsed).toContain("<!-- t:843 -->");
  });

  it("never downgrades a transcript that a concurrent retry produced", async () => {
    const written = await writeSource(root, blockedVideo());
    const sourceRel = `library/${written.id}/source.md`;
    const concurrent: YoutubeTranscriptEngine = {
      hasCredentials: () => false,
      // Simulate another retry finishing first: it upgrades the source, then
      // this run's own extraction fails.
      transcript: vi.fn(async () => {
        const text = await fs.readFile(path.join(root, sourceRel), "utf8");
        await fs.writeFile(
          path.join(root, sourceRel),
          text.replace("parse_tier: basic", "parse_tier: transcript").replace(/parse_warning:.*\n/, ""),
          "utf8",
        );
        return { ok: false as const, kind: "blocked" as const, retryable: false };
      }),
      metadata: vi.fn(async () => ({ title: null, author: null, thumbnail: null })),
    };
    const runtime = await fauxRuntime();
    await runRetryWith(written.id, "https://www.youtube.com/watch?v=dQw4w9WgXcQ", concurrent, runtime);
    const view = await readSource(root, written.id);
    expect(view?.source.parseTier).toBe("transcript");
  });
});
