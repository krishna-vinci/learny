import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventHub } from "../events.js";
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

  it("rejects a direct request without the draft-chapter discriminator", async () => {
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
