import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventHub } from "../events.js";
import { ensureRepo, log } from "../tree/git.js";
import { ProposalStore } from "./proposals.js";
import { jobsRoutes } from "./routes.js";
import { JobRunner } from "./runner.js";

let root: string;
let runner: JobRunner;
let app: Hono;
let proposals: ProposalStore;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-jobroutes-"));
  runner = new JobRunner({ root, hub: new EventHub(), maxParallel: 2 });
  proposals = new ProposalStore();
  app = new Hono();
  app.route("/api/jobs", jobsRoutes({ runner, proposals }));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("jobs routes", () => {
  it("starts compile-book with only a set and rejects traversal and missing sets", async () => {
    await fs.mkdir(path.join(root, "alpha"));
    await fs.writeFile(path.join(root, "alpha/PLAN.md"), "# Alpha");
    const rooted = new Hono();
    rooted.route("/api/jobs", jobsRoutes({ runner, root }));
    const handler = vi.fn(async (_input: unknown) => undefined);
    runner.register("compile-book", handler);
    const post = (set: string) =>
      rooted.request("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "compile-book", set }),
      });
    expect((await post("../outside")).status).toBe(400);
    expect((await post("missing")).status).toBe(404);
    const response = await post("alpha");
    expect(response.status).toBe(202);
    const { jobId } = (await response.json()) as { jobId: string };
    await vi.waitFor(() => expect(runner.get(jobId)?.status).toBe("done"));
    expect(handler.mock.calls[0]?.[0]).toEqual({ set: "alpha" });
    expect(runner.get(jobId)?.kind).toBe("compile-book");
  });

  it("creates a missing set before enqueueing plan-set and rejects bad input without creating a set", async () => {
    await ensureRepo(root);
    const rooted = new Hono();
    rooted.route("/api/jobs", jobsRoutes({ runner, root }));
    const received: unknown[] = [];
    runner.register("plan-set", async (input) => {
      received.push(input);
      return undefined;
    });
    const post = (patch: Record<string, unknown> = {}) =>
      rooted.request("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "plan-set", set: "new-set", goal: "Learn algebra", ...patch }),
      });
    expect((await post({ level: 6 })).status).toBe(400);
    expect((await post({ deadline: "2026-02-31" })).status).toBe(400);
    await expect(fs.access(path.join(root, "new-set"))).rejects.toThrow();
    const response = await post({ level: 2, deadline: "2026-12-01" });
    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({ jobId: expect.any(String), set: "new-set" });
    await vi.waitFor(() => expect(received).toHaveLength(1));
    expect(received[0]).toMatchObject({ set: "new-set", goal: "Learn algebra", level: 2, deadline: "2026-12-01" });
    expect(await fs.readFile(path.join(root, "new-set/PLAN.md"), "utf8")).toContain("Learn algebra");
    expect((await log(root, { limit: 1 }))[0]).toMatchObject({ author: "user", subject: "user: create set new-set" });
    await post({ goal: "Learn more" });
    expect(await fs.readdir(root)).not.toContain("new-set-2");
  });
  it("rejects make-cards for a note that does not exist (404) when the root is known", async () => {
    const rooted = new Hono();
    rooted.route("/api/jobs", jobsRoutes({ runner, proposals, root }));
    await fs.mkdir(path.join(root, "alpha", "notes"), { recursive: true });
    await fs.writeFile(path.join(root, "alpha", "notes", "01-a.md"), "# A\n");
    runner.register("make-cards", async () => undefined);
    const post = (note: string) =>
      rooted.request("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "make-cards", set: "alpha", note }),
      });
    expect((await post("notes/99-missing.md")).status).toBe(404);
    expect((await post("notes/01-a.md")).status).toBe(202);
  });

  it("starts a draft job directly or from a one-shot proposal", async () => {
    runner.register("draft-chapter", async () => undefined);
    const direct = await app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "draft-chapter", set: "alpha", title: "Vectors", sources: ["lib-source"] }),
    });
    expect(direct.status).toBe(202);

    const proposal = proposals.create({ set: "beta", title: "Matrices" }, { tokens: 5_000, costUsd: null });
    const proposed = await app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proposalId: proposal.proposalId }),
    });
    expect(proposed.status).toBe(202);
    expect(
      (
        await app.request("/api/jobs", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ proposalId: proposal.proposalId }),
        })
      ).status,
    ).toBe(404);
    expect(runner.list().map((job) => job.set)).toEqual(["beta", "alpha"]);
  });

  it("starts a make-cards job directly or from a proposal", async () => {
    runner.register("make-cards", async () => undefined);
    const direct = await app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "make-cards", set: "alpha", note: "notes/03-svd.md", count: 0 }),
    });
    expect(direct.status).toBe(202);

    const proposal = proposals.createCards(
      { kind: "make-cards", set: "beta", note: "notes/04-rank.md", count: 12 },
      { tokens: 5_000, costUsd: null },
    );
    const proposed = await app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ proposalId: proposal.proposalId }),
    });
    expect(proposed.status).toBe(202);
    expect(runner.list().map((job) => job.kind)).toEqual(["make-cards", "make-cards"]);
  });

  it("validates make-cards note paths and counts", async () => {
    const invalidPath = await app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "make-cards", set: "alpha", note: "../PLAN.md" }),
    });
    const invalidCount = await app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "make-cards", set: "alpha", note: "notes/03-svd.md", count: 41 }),
    });
    expect(invalidPath.status).toBe(400);
    expect(invalidCount.status).toBe(400);
  });

  it("rejects a direct request without a supported job discriminator", async () => {
    const response = await app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ set: "alpha", title: "Vectors" }),
    });
    expect(response.status).toBe(400);
  });

  it("lists jobs, optionally filtered by set", async () => {
    runner.register("ingest", async () => undefined);
    const alpha = runner.enqueue("ingest", {}, { set: "alpha", title: "A" });
    await vi.waitFor(() => expect(runner.get(alpha.id)?.status).toBe("done"));
    runner.enqueue("draft-chapter", {}, { set: "beta", title: "B" });

    const all = await app.request("/api/jobs");
    expect(all.status).toBe(200);
    expect(((await all.json()) as unknown[]).length).toBe(2);

    const filtered = await app.request("/api/jobs?set=beta");
    expect(filtered.status).toBe(200);
    const jobs = (await filtered.json()) as Array<{ set: string }>;
    expect(jobs.every((job) => job.set === "beta")).toBe(true);
  });

  it("lists seeded history and filters it by set", async () => {
    runner.seedHistory([
      {
        id: "log:alpha:1",
        kind: "ingest",
        set: "alpha",
        title: "Old alpha job",
        status: "done",
        progress: "",
        startedAt: null,
        finishedAt: "2026-09-29T10:00Z",
        usage: { input: 10, output: 2, cacheRead: 0, cacheWrite: 0, costUsd: 0.01 },
        billing: "metered",
      },
      {
        id: "log:beta:1",
        kind: "make-cards",
        set: "beta",
        title: "Old beta job",
        status: "failed",
        progress: "",
        startedAt: null,
        finishedAt: "2026-09-29T11:00Z",
        usage: { input: 20, output: 4, cacheRead: 0, cacheWrite: 0, costUsd: 0.02 },
        billing: "metered",
      },
    ]);

    const all = (await (await app.request("/api/jobs")).json()) as Array<{ id: string }>;
    expect(all.map((job) => job.id)).toEqual(["log:beta:1", "log:alpha:1"]);
    const alpha = (await (await app.request("/api/jobs?set=alpha")).json()) as Array<{ id: string }>;
    expect(alpha.map((job) => job.id)).toEqual(["log:alpha:1"]);
  });

  it("cancels a running job with 204", async () => {
    runner.register("ingest", async (_input, ctx) => {
      await new Promise<void>((_resolve, reject) => {
        ctx.signal.addEventListener("abort", () => reject(new Error("aborted")));
      });
      return undefined;
    });
    const job = runner.enqueue("ingest", {}, { set: null, title: "Slow" });
    await vi.waitFor(() => expect(runner.get(job.id)?.status).toBe("running"));

    const response = await app.request(`/api/jobs/${job.id}/cancel`, { method: "POST" });
    expect(response.status).toBe(204);
    await vi.waitFor(() => expect(runner.get(job.id)?.status).toBe("cancelled"));
  });

  it("returns 404 for an unknown job and 409 for a finished one", async () => {
    runner.register("ingest", async () => undefined);
    const job = runner.enqueue("ingest", {}, { set: null, title: "Done" });
    await vi.waitFor(() => expect(runner.get(job.id)?.status).toBe("done"));

    expect((await app.request("/api/jobs/nope/cancel", { method: "POST" })).status).toBe(404);
    expect((await app.request(`/api/jobs/${job.id}/cancel`, { method: "POST" })).status).toBe(409);
  });
});

it("returns 403 from the enqueue boundary and retains card passages", async () => {
  const denied = new JobRunner({ root, hub: new EventHub(), maxParallel: 1, aiAllowed: () => false });
  const deniedApp = new Hono();
  deniedApp.route("/api/jobs", jobsRoutes({ runner: denied }));
  const response = await deniedApp.request("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      kind: "make-cards",
      set: "alpha",
      note: "notes/01-vectors.md",
      passage: "Selected sentence",
      count: 1,
    }),
  });
  expect(response.status).toBe(403);
  expect(denied.list()).toEqual([]);
  const received: unknown[] = [];
  runner.register("make-cards", async (input) => {
    received.push(input);
    return undefined;
  });
  const proposal = proposals.createCards(
    { kind: "make-cards", set: "alpha", note: "notes/01-vectors.md", passage: "Selected sentence", count: 1 },
    { tokens: 1, costUsd: null },
  );
  const accepted = await app.request("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proposalId: proposal.proposalId }),
  });
  expect(accepted.status).toBe(202);
  await vi.waitFor(() => expect(received).toHaveLength(1));
  expect(received[0]).toMatchObject({ passage: "Selected sentence", note: "notes/01-vectors.md" });
  const tooLong = await app.request("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "make-cards", set: "alpha", note: "notes/01-vectors.md", passage: "x".repeat(2001) }),
  });
  expect(tooLong.status).toBe(400);
});

it("validates rewrite paths and missing notes and enforces the enqueue AI gate", async () => {
  const rooted = new Hono();
  rooted.route("/api/jobs", jobsRoutes({ runner, root }));
  await fs.mkdir(path.join(root, "alpha/notes"), { recursive: true });
  await fs.writeFile(path.join(root, "alpha/notes/01-a.md"), "# A");
  runner.register("rewrite-chapter", async () => undefined);
  const post = (app: Hono, path: string) =>
    app.request("/api/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "rewrite-chapter", set: "alpha", path }),
    });
  expect((await post(rooted, "../outside.md")).status).toBe(400);
  expect((await post(rooted, "notes/99-missing.md")).status).toBe(404);
  expect((await post(rooted, "notes/01-a.md")).status).toBe(202);
  expect(runner.list()[0]?.kind).toBe("rewrite-chapter");
  const denied = new JobRunner({ root, hub: new EventHub(), maxParallel: 1, aiAllowed: () => false });
  const deniedApp = new Hono();
  deniedApp.route("/api/jobs", jobsRoutes({ runner: denied, root }));
  expect((await post(deniedApp, "notes/01-a.md")).status).toBe(403);
  expect(denied.list()).toEqual([]);
});

it("accepts a tutor rewrite proposal with its original discriminator and path", async () => {
  const rooted = new Hono();
  rooted.route("/api/jobs", jobsRoutes({ runner, root, proposals }));
  await fs.mkdir(path.join(root, "alpha/notes"), { recursive: true });
  await fs.writeFile(path.join(root, "alpha/notes/01-a.md"), "# A");
  runner.register("rewrite-chapter", async () => undefined);
  const proposal = proposals.createRewrite(
    { kind: "rewrite-chapter", set: "alpha", path: "notes/01-a.md" },
    { tokens: 100, costUsd: null },
  );
  const response = await rooted.request("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ proposalId: proposal.proposalId }),
  });
  expect(response.status).toBe(202);
  expect(runner.list()[0]?.kind).toBe("rewrite-chapter");
});
