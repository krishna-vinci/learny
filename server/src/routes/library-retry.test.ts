import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventHub } from "../events.js";
import { writeSource } from "../ingest/library.js";
import type { Extracted } from "../ingest/types.js";
import { JobRunner } from "../jobs/runner.js";
import { ensureRepo } from "../tree/git.js";
import { initStudyTree } from "../tree/init.js";
import { libraryRoutes } from "./library.js";

vi.mock("node:dns", () => ({
  promises: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) },
}));

function blockedVideo(overrides: Partial<Extracted> = {}): Extracted {
  return {
    title: "A Blocked Talk",
    authors: ["A Channel"],
    markdown: "",
    pages: null,
    parseTier: "basic",
    warning: "YouTube blocked the transcript for this video — try again later, or set up YouTube sign-in in Settings",
    transcriptStatus: "blocked",
    unreadable: true,
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    originalExt: null,
    ...overrides,
  };
}

let root: string;
let app: Hono;
let received: unknown[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-retry-route-"));
  await initStudyTree(root);
  await ensureRepo(root);
  received = [];
  const hub = new EventHub();
  const jobs = new JobRunner({ root, hub, maxParallel: 1 });
  jobs.register("ingest", async (input) => {
    received.push(input);
    return { sourceId: "stub" };
  });
  app = new Hono();
  app.route("/api/library", libraryRoutes({ root, jobs, hub }));
});

afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

describe("POST /api/library/:id/retry-transcript", () => {
  it("enqueues an ingest retry with the explicit source id and URL", async () => {
    const written = await writeSource(root, blockedVideo());
    const response = await app.request(`/api/library/${written.id}/retry-transcript`, { method: "POST" });
    expect(response.status).toBe(202);
    const body = (await response.json()) as { jobId: string };
    expect(body.jobId).toBeTruthy();
    expect(received).toEqual([
      { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", set: null, retrySourceId: written.id },
    ]);
  });

  it("rejects a source whose transcript is not retryable", async () => {
    const written = await writeSource(
      root,
      blockedVideo({ transcriptStatus: "no-captions", warning: "This video has no captions" }),
    );
    const response = await app.request(`/api/library/${written.id}/retry-transcript`, { method: "POST" });
    expect(response.status).toBe(400);
    expect(received).toHaveLength(0);
  });

  it("404s for an unknown or malformed source id", async () => {
    expect((await app.request("/api/library/lib-missing/retry-transcript", { method: "POST" })).status).toBe(404);
    expect((await app.request("/api/library/nope!/retry-transcript", { method: "POST" })).status).toBe(404);
  });
});
