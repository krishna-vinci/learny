import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventHub } from "../events.js";
import { type IngestJobInput, writeSource } from "../ingest/library.js";
import type { Extracted } from "../ingest/types.js";
import { JobRunner } from "../jobs/runner.js";
import { ensureRepo } from "../tree/git.js";
import { initStudyTree } from "../tree/init.js";
import { libraryRoutes } from "./library.js";

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

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-library-routes-"));
  await initStudyTree(root);
  await ensureRepo(root);
  received = [];
  jobs = new JobRunner({ root, hub: new EventHub(), maxParallel: 2 });
  jobs.register("ingest", async (input) => {
    received.push(input as IngestJobInput);
    return { sourceId: "lib-stub" };
  });
  app = new Hono();
  app.route("/api/library", libraryRoutes({ root, jobs, maxUploadBytes: 1024 }));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function postJson(body: unknown) {
  return app.request("/api/library", {
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
