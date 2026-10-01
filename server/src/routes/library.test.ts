import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventHub } from "../events.js";
import { type IngestJobInput, writeSource } from "../ingest/library.js";
import type { Extracted } from "../ingest/types.js";
import { JobRunner } from "../jobs/runner.js";
import { ensureRepo } from "../tree/git.js";
import { initStudyTree } from "../tree/init.js";
import { libraryRoutes } from "./library.js";

vi.mock("node:dns", () => ({ promises: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) } }));

function makeExtracted(overrides: Partial<Extracted> = {}): Extracted {
  return {
    title: "Introduction to Linear Algebra",
    authors: ["Gilbert Strang"],
    markdown: "# Vectors\n\nA short note about vectors.\n",
    pages: null,
    parseTier: "basic",
    warning: null,
    url: null,
    originalExt: "pdf",
    ...overrides,
  };
}

let root: string;
let jobs: JobRunner;
let received: IngestJobInput[];
let app: Hono;
let hub: EventHub;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-library-routes-"));
  await initStudyTree(root);
  await ensureRepo(root);
  received = [];
  vi.stubEnv("FIRECRAWL_API_URL", "");
  vi.stubEnv("FIRECRAWL_API_KEY", "");
  hub = new EventHub();
  jobs = new JobRunner({ root, hub, maxParallel: 2 });
  jobs.register("ingest", async (input) => {
    received.push(input as IngestJobInput);
    return { sourceId: "lib-stub" };
  });
  app = new Hono();
  app.route("/api/library", libraryRoutes({ root, jobs, hub, maxUploadBytes: 1024 }));
});

afterEach(async () => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

function postJson(body: unknown) {
  return app.request("/api/library", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function postSite(target: "site-map" | "site-import", body: unknown) {
  return app.request(`/api/library/${target}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

async function markSummarized(id: string): Promise<void> {
  const file = path.join(root, "library", id, "source.md");
  const text = await fs.readFile(file, "utf8");
  await fs.writeFile(file, text.replace("credibility: pending", "credibility: B"));
}

describe("GET /api/library", () => {
  it("lists sources and returns a source view", async () => {
    expect(await (await app.request("/api/library")).json()).toEqual([]);

    const { id } = await writeSource(root, makeExtracted({ url: "https://example.com/book" }));

    const list = (await (await app.request("/api/library")).json()) as Array<{ id: string }>;
    expect(list.map((source) => source.id)).toEqual([id]);

    const detail = await app.request(`/api/library/${id}`);
    expect(detail.status).toBe(200);
    const view = (await detail.json()) as { source: { id: string }; body: string; parsedFiles: string[] };
    expect(view.source.id).toBe(id);
    expect(view.body).toContain("Summary pending.");
    expect(view.parsedFiles).toEqual(["parsed.md"]);

    expect((await app.request("/api/library/lib-missing")).status).toBe(404);
  });
});

describe("GET /api/library/:id/parsed", () => {
  it("returns a listed parsed file's markdown", async () => {
    const { id } = await writeSource(root, makeExtracted({ url: "https://example.com/book" }));

    const response = await app.request(`/api/library/${id}/parsed?file=parsed.md`);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      file: "parsed.md",
      markdown: "# Vectors\n\nA short note about vectors.\n",
    });
  });

  it("404s for an unlisted, escaping or unknown file and 400s without file", async () => {
    const { id } = await writeSource(root, makeExtracted({ url: "https://example.com/book" }));

    expect((await app.request(`/api/library/${id}/parsed?file=source.md`)).status).toBe(404);
    expect((await app.request(`/api/library/${id}/parsed?file=../../etc/passwd`)).status).toBe(404);
    expect((await app.request("/api/library/lib-missing/parsed?file=parsed.md")).status).toBe(404);
    expect((await app.request(`/api/library/${id}/parsed`)).status).toBe(400);
  });
});

describe("POST /api/library", () => {
  it("enqueues an ingest job for a URL", async () => {
    const response = await postJson({ url: "https://example.com/article" });
    expect(response.status).toBe(202);
    const { jobId } = (await response.json()) as { jobId: string };

    expect(jobs.get(jobId)?.kind).toBe("ingest");
    expect(jobs.get(jobId)?.set).toBeNull();
    await flush();
    expect(received[0]).toMatchObject({ url: "https://example.com/article", set: null });
  });

  it("links to a set and enqueues with it", async () => {
    await fs.mkdir(path.join(root, "linear-algebra"), { recursive: true });
    await fs.writeFile(path.join(root, "linear-algebra", "PLAN.md"), "---\ntitle: LA\n---\n");

    const response = await postJson({ url: "https://example.com/article", set: "linear-algebra" });
    expect(response.status).toBe(202);
    const { jobId } = (await response.json()) as { jobId: string };
    expect(jobs.get(jobId)?.set).toBe("linear-algebra");
  });

  it("returns the existing source (200) when a URL is already ingested", async () => {
    const { id } = await writeSource(root, makeExtracted({ url: "https://example.com/article" }));
    await markSummarized(id);
    const response = await postJson({ url: "https://example.com/article#section" });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sourceId: id, deduped: true });
    expect(jobs.list()).toHaveLength(0);
  });

  it("enqueues a job (202) for a duplicate whose summary is still pending, so the job can resume it", async () => {
    await writeSource(root, makeExtracted({ url: "https://example.com/article" }));
    const response = await postJson({ url: "https://example.com/article" });

    expect(response.status).toBe(202);
    expect(jobs.list()).toHaveLength(1);
  });

  it("rejects a missing URL, a non-URL and an unknown set", async () => {
    expect((await postJson({})).status).toBe(400);
    expect((await postJson({ url: "not a url" })).status).toBe(400);
    expect((await postJson({ url: "https://example.com/x", set: "nope" })).status).toBe(400);
  });

  it("enqueues an ingest job for a multipart file", async () => {
    const form = new FormData();
    form.append("file", new File([new TextEncoder().encode("# Doc\n\nHi\n")], "doc.md", { type: "text/markdown" }));

    const response = await app.request("/api/library", { method: "POST", body: form });
    expect(response.status).toBe(202);
    const { jobId } = (await response.json()) as { jobId: string };
    expect(jobs.get(jobId)?.title).toBe("doc.md");

    await flush();
    const input = received[0];
    expect(input?.filename).toBe("doc.md");
    expect(input === undefined ? "" : new TextDecoder().decode(input.bytes)).toContain("# Doc");
  });

  it("rejects an oversized multipart file with 413", async () => {
    const form = new FormData();
    form.append("file", new File([new Uint8Array(4096)], "big.pdf", { type: "application/pdf" }));

    const response = await app.request("/api/library", { method: "POST", body: form });
    expect(response.status).toBe(413);
  });

  it("rejects more than one file part with 400", async () => {
    const form = new FormData();
    form.append("file", new File([new TextEncoder().encode("a")], "a.md", { type: "text/markdown" }));
    form.append("file", new File([new TextEncoder().encode("b")], "b.md", { type: "text/markdown" }));

    const response = await app.request("/api/library", { method: "POST", body: form });
    expect(response.status).toBe(400);
  });

  it("returns the existing source (200) when a file was already ingested", async () => {
    const fileBytes = new TextEncoder().encode("# Same\n\nbody\n");
    const { id } = await writeSource(root, makeExtracted({ url: null }), { bytes: fileBytes, ext: "pdf" });
    await markSummarized(id);

    const form = new FormData();
    form.append("file", new File([fileBytes], "same.pdf", { type: "application/pdf" }));
    const response = await app.request("/api/library", { method: "POST", body: form });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ sourceId: id, deduped: true });
  });
});

describe("POST /api/library/site-map", () => {
  it("returns a clear 400 when Firecrawl is not configured", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const response = await postSite("site-map", { url: "https://example.com" });
    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "Site mapping requires Firecrawl. Configure FIRECRAWL_API_URL." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns filtered pages and forwards search, limit and the configured key", async () => {
    vi.stubEnv("FIRECRAWL_API_URL", "http://127.0.0.1:3002/v2");
    vi.stubEnv("FIRECRAWL_API_KEY", "test-key");
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) =>
      Response.json({
        success: true,
        links: [
          { url: "https://docs.example.com/guide", title: "Guide", description: "Getting started" },
          "https://example.com/start",
          "https://another.org/",
          "http://127.0.0.1/",
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await postSite("site-map", { url: "https://example.com", search: "guide", limit: 20 });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      pages: [
        { url: "https://docs.example.com/guide", title: "Guide", description: "Getting started" },
        { url: "https://example.com/start" },
      ],
    });
    const [endpoint, init] = fetchMock.mock.calls[0] ?? [];
    expect(endpoint).toBe("http://127.0.0.1:3002/v2/map");
    expect(init?.headers).toMatchObject({ authorization: "Bearer test-key" });
    expect(JSON.parse(String(init?.body))).toMatchObject({ search: "guide", limit: 20 });
    expect(jobs.list()).toHaveLength(0);
  });

  it("rejects invalid requests, private URLs, and limits outside 1–500 before fetching", async () => {
    vi.stubEnv("FIRECRAWL_API_URL", "http://127.0.0.1:3002");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    for (const body of [
      {},
      { url: "bad" },
      { url: "http://127.0.0.1/" },
      { url: "https://example.com", search: 1 },
      ...[0, 501, 1.5, "20"].map((limit) => ({ url: "https://example.com", limit })),
    ]) {
      expect((await postSite("site-map", body)).status).toBe(400);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns a 502 when Firecrawl fails", async () => {
    vi.stubEnv("FIRECRAWL_API_URL", "http://127.0.0.1:3002");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ success: false, error: "map unavailable" })),
    );
    const response = await postSite("site-map", { url: "https://example.com" });
    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "Firecrawl map failed: map unavailable" });
  });
});

describe("POST /api/library/site-import", () => {
  it("rejects 101 URLs, invalid arrays and unknown sets without enqueueing", async () => {
    for (const body of [
      { urls: Array.from({ length: 101 }, (_, i) => `https://example.com/${i}`) },
      {},
      { urls: [] },
      { urls: "https://example.com" },
      { urls: [1] },
      { urls: [""] },
      { urls: ["https://example.com"], set: "missing" },
    ]) {
      expect((await postSite("site-import", body)).status).toBe(400);
    }
    expect(jobs.list()).toHaveLength(0);
  });

  it("skips existing sources and repeated selections, then uses the existing ingest input with the set", async () => {
    await fs.mkdir(path.join(root, "linear-algebra"));
    const stored = await writeSource(root, makeExtracted({ url: "https://example.com/stored" }));
    await markSummarized(stored.id);
    const pending = await writeSource(root, makeExtracted({ url: "https://example.com/pending" }));
    const response = await postSite("site-import", {
      urls: [
        "https://example.com/stored#section",
        "https://example.com/pending",
        "https://example.com/new",
        "https://example.com/new#section",
      ],
      set: "linear-algebra",
    });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({
      queued: 1,
      skipped: [
        { url: "https://example.com/stored#section", reason: `already in library: ${stored.id}` },
        { url: "https://example.com/pending", reason: `already in library: ${pending.id}` },
        { url: "https://example.com/new#section", reason: "duplicate URL in this import" },
      ],
    });
    await vi.waitFor(() => expect(received).toEqual([{ url: "https://example.com/new", set: "linear-algebra" }]));
    expect(jobs.list()[0]).toMatchObject({ kind: "ingest", set: "linear-algebra", title: "new" });
  });

  it("rechecks selected URLs and reports unsafe or malformed URLs as skipped", async () => {
    const urls = ["http://127.0.0.1/admin", "http://192.168.1.1/admin", "file:///etc/passwd", "bad URL"];
    const response = await postSite("site-import", { urls });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { queued: number; skipped: { url: string; reason: string }[] };
    expect(body.queued).toBe(0);
    expect(body.skipped.map((item) => item.url)).toEqual(urls);
    expect(body.skipped.every((item) => item.reason.length > 0)).toBe(true);
    expect(jobs.list()).toHaveLength(0);
  });

  it("runs at most three ingests, waits for cancelled handlers to exit, and continues after failure", async () => {
    jobs = new JobRunner({ root, hub, maxParallel: 10 });
    app = new Hono();
    app.route("/api/library", libraryRoutes({ root, jobs, hub }));
    const holds = new Map<string, { resolve: () => void; reject: (error: Error) => void }>();
    let running = 0;
    let peak = 0;
    jobs.register("ingest", async (input) => {
      const page = input as IngestJobInput;
      const url = page.url as string;
      received.push(page);
      running++;
      peak = Math.max(peak, running);
      try {
        await new Promise<void>((resolve, reject) => holds.set(url, { resolve, reject }));
        return { sourceId: "lib-stub" };
      } finally {
        running--;
      }
    });
    const originalSubscribe = hub.subscribe.bind(hub);
    const unsubscribed = vi.fn();
    vi.spyOn(hub, "subscribe").mockImplementation((listener) => {
      const stop = originalSubscribe(listener);
      return () => {
        unsubscribed();
        stop();
      };
    });
    const urls = Array.from({ length: 7 }, (_, i) => `https://example.com/${i}`);
    const response = await postSite("site-import", { urls });
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ queued: 7, skipped: [] });
    await vi.waitFor(() => expect(received).toHaveLength(3));
    expect(jobs.list()).toHaveLength(3);

    const first = jobs.list().find((job) => job.title === "0");
    expect(first).toBeDefined();
    expect(jobs.cancel(first?.id ?? "")).toBe(true);
    await flush();
    expect(received).toHaveLength(3);
    expect(running).toBe(3);
    holds.get(urls[0] ?? "")?.resolve();
    await vi.waitFor(() => expect(received).toHaveLength(4));
    expect(running).toBe(3);

    holds.get(urls[1] ?? "")?.reject(new Error("stub ingest failed"));
    await vi.waitFor(() => expect(received).toHaveLength(5));
    expect(jobs.list().find((job) => job.title === "1")?.status).toBe("failed");
    for (let i = 2; i < urls.length; i++) {
      await vi.waitFor(() => expect(holds.has(urls[i] ?? "")).toBe(true));
      holds.get(urls[i] ?? "")?.resolve();
    }
    await vi.waitFor(() => expect(jobs.list().every((job) => job.finishedAt !== null)).toBe(true));
    expect(received.map((input) => input.url)).toEqual(urls);
    expect(peak).toBe(3);
    expect(running).toBe(0);
    // The queue unsubscribes when the final page finishes.
    expect(unsubscribed).toHaveBeenCalledTimes(1);
    await flush();
  });
});

it("stops the pending import tail when AI permission is revoked without breaking job completion", async () => {
  let allowed = true;
  jobs = new JobRunner({ root, hub, maxParallel: 3, aiAllowed: () => allowed });
  const holds: (() => void)[] = [];
  jobs.register("ingest", async (input) => {
    received.push(input as IngestJobInput);
    await new Promise<void>((resolve) => holds.push(resolve));
    return undefined;
  });
  app = new Hono();
  app.route("/api/library", libraryRoutes({ root, jobs, hub }));
  const response = await postSite("site-import", {
    urls: Array.from({ length: 5 }, (_, i) => `https://example.com/${i}`),
  });
  expect(response.status).toBe(202);
  await vi.waitFor(() => expect(holds).toHaveLength(3));
  allowed = false;
  for (const release of holds) release();
  await vi.waitFor(() => expect(jobs.list().every((job) => job.finishedAt !== null)).toBe(true));
  expect(received).toHaveLength(3);
  expect(jobs.list()).toHaveLength(3);
});
