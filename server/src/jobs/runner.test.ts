import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StudiumEvent } from "@studium/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventHub } from "../events.js";
import { JobRunner, usageFromPiMessages } from "./runner.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-jobs-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function makeRunner(overrides: { maxParallel?: number; hub?: EventHub } = {}) {
  const hub = overrides.hub ?? new EventHub();
  const runner = new JobRunner({ root, hub, maxParallel: overrides.maxParallel ?? 2 });
  return { runner, hub };
}

describe("JobRunner", () => {
  it("runs a registered handler, tracks usage, and publishes job events", async () => {
    const hub = new EventHub();
    const events: StudiumEvent[] = [];
    hub.subscribe((event) => events.push(event));
    const { runner } = makeRunner({ hub });

    runner.register("draft-chapter", async (input, ctx) => {
      expect(input).toEqual({ brief: "SVD" });
      ctx.progress("outlining");
      ctx.addUsage({ input: 10_000, output: 200, costUsd: 0.01 });
      ctx.addUsage({ input: 2_000, output: 100, cacheRead: 500, costUsd: 0.03 });
      return { notePath: "notes/04-svd.md", commitSha: "abcdef1234567890" };
    });

    const queued = runner.enqueue("draft-chapter", { brief: "SVD" }, { set: "linear-algebra", title: "SVD" });
    expect(queued.status).toBe("queued");
    expect(queued.startedAt).toBeNull();

    await vi.waitFor(() => expect(runner.get(queued.id)?.status).toBe("done"));
    const done = runner.get(queued.id);
    expect(done?.progress).toBe("outlining");
    expect(done?.result).toEqual({ notePath: "notes/04-svd.md", commitSha: "abcdef1234567890" });
    expect(done?.usage).toEqual({ input: 12_000, output: 300, cacheRead: 500, cacheWrite: 0, costUsd: 0.04 });
    expect(done?.finishedAt).not.toBeNull();

    const jobEvents = events.flatMap((event) => (event.type === "job" ? [event.job] : []));
    expect(jobEvents.map((job) => job.status)).toEqual(["queued", "running", "running", "running", "running", "done"]);

    await vi.waitFor(async () => {
      const log = await fs.readFile(path.join(root, "linear-algebra/log/jobs.md"), "utf8");
      expect(log).toContain('draft-chapter · "SVD" · done · 12.0k in / 300 out · $0.04 · commit abcdef1');
    });
  });

  it("fails a job whose handler throws and records the message", async () => {
    const { runner } = makeRunner();
    runner.register("draft-chapter", async () => {
      throw new Error("boom");
    });

    const job = runner.enqueue("draft-chapter", {}, { set: "linear-algebra", title: "Bad" });
    await vi.waitFor(() => expect(runner.get(job.id)?.status).toBe("failed"));
    expect(runner.get(job.id)?.error).toBe("boom");
  });

  it("fails a job when no handler is registered for its kind", async () => {
    const { runner } = makeRunner();
    const job = runner.enqueue("ingest", {}, { set: null, title: "Orphan" });

    await vi.waitFor(() => expect(runner.get(job.id)?.status).toBe("failed"));
    expect(runner.get(job.id)?.error).toContain("ingest");
    await vi.waitFor(async () => {
      const log = await fs.readFile(path.join(root, "library/_jobs.md"), "utf8");
      expect(log).toContain('"Orphan" · failed');
    });
  });

  it("never runs more than maxParallel jobs at once", async () => {
    const { runner } = makeRunner({ maxParallel: 1 });
    const started: string[] = [];
    const release: Array<() => void> = [];
    runner.register("ingest", async (input) => {
      started.push((input as { id: string }).id);
      await new Promise<void>((resolve) => release.push(resolve));
      return undefined;
    });

    const first = runner.enqueue("ingest", { id: "a" }, { set: null, title: "A" });
    const second = runner.enqueue("ingest", { id: "b" }, { set: null, title: "B" });

    await vi.waitFor(() => expect(started).toEqual(["a"]));
    expect(runner.get(second.id)?.status).toBe("queued");

    release[0]?.();
    await vi.waitFor(() => expect(started).toEqual(["a", "b"]));
    expect(runner.get(first.id)?.status).toBe("done");

    release[1]?.();
    await vi.waitFor(() => expect(runner.get(second.id)?.status).toBe("done"));
  });

  it("cancels a running job and aborts its signal", async () => {
    const { runner } = makeRunner();
    let aborted = false;
    runner.register("ingest", async (_input, ctx) => {
      await new Promise<void>((_resolve, reject) => {
        ctx.signal.addEventListener("abort", () => {
          aborted = true;
          reject(new Error("aborted"));
        });
      });
      return undefined;
    });

    const job = runner.enqueue("ingest", {}, { set: null, title: "Slow" });
    await vi.waitFor(() => expect(runner.get(job.id)?.status).toBe("running"));

    expect(runner.cancel(job.id)).toBe(true);
    expect(aborted).toBe(true);
    await vi.waitFor(() => expect(runner.get(job.id)?.status).toBe("cancelled"));
    expect(runner.cancel(job.id)).toBe(false);
  });

  it("cancels a queued job before it ever starts", async () => {
    const { runner } = makeRunner({ maxParallel: 1 });
    const started: string[] = [];
    const release: Array<() => void> = [];
    runner.register("ingest", async (input) => {
      started.push((input as { id: string }).id);
      await new Promise<void>((resolve) => release.push(resolve));
      return undefined;
    });

    runner.enqueue("ingest", { id: "a" }, { set: null, title: "A" });
    const queued = runner.enqueue("ingest", { id: "b" }, { set: null, title: "B" });
    await vi.waitFor(() => expect(started).toEqual(["a"]));

    expect(runner.cancel(queued.id)).toBe(true);
    release[0]?.();
    await vi.waitFor(() => expect(runner.get(queued.id)?.status).toBe("cancelled"));
    expect(started).toEqual(["a"]);
  });

  it("lists newest first and filters by set", async () => {
    const { runner } = makeRunner();
    runner.register("ingest", async () => undefined);
    const older = runner.enqueue("ingest", {}, { set: "alpha", title: "Older" });
    await vi.waitFor(() => expect(runner.get(older.id)?.status).toBe("done"));
    const newer = runner.enqueue("ingest", {}, { set: "beta", title: "Newer" });

    expect(runner.list().map((job) => job.id)).toEqual([newer.id, older.id]);
    expect(runner.list("alpha").map((job) => job.id)).toEqual([older.id]);
    expect(runner.list("missing")).toEqual([]);
  });
});

describe("usageFromPiMessages", () => {
  it("sums assistant usage and ignores other roles", () => {
    const usage = usageFromPiMessages([
      { role: "user", content: "hi" },
      {
        role: "assistant",
        usage: {
          input: 10,
          output: 5,
          cacheRead: 2,
          cacheWrite: 1,
          totalTokens: 18,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.03 },
        },
      },
      {
        role: "assistant",
        usage: {
          input: 4,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 5,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
        },
      },
      { role: "toolResult", usage: { input: 999, cost: { total: 9 } } },
    ]);

    expect(usage).toEqual({ input: 14, output: 6, cacheRead: 2, cacheWrite: 1, costUsd: 0.04 });
  });

  it("tolerates malformed messages", () => {
    expect(usageFromPiMessages([null, 42, { role: "assistant" }, { role: "assistant", usage: "nope" }])).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      costUsd: 0,
    });
  });
});
