import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { JobView } from "@studium/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventHub } from "../events.js";
import { AiDisabledError, JobRunner } from "../jobs/runner.js";
import { defaultPlanKickoffsFile, PlanKickoffs } from "./plan-kickoffs.js";

const SAMPLE_SET = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));
const set = "linear-algebra";
const urls = ["https://example.org/one", "https://example.org/two"];
const chapters = [{ title: "Vectors", brief: "Vectors and scalars." }];
let root: string;
const stores: PlanKickoffs[] = [];
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-kickoffs-"));
  await fs.cp(SAMPLE_SET, root, { recursive: true });
});
afterEach(async () => {
  for (const store of stores.splice(0)) store.dispose();
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

function harness() {
  const hub = new EventHub();
  const jobs = new JobRunner({ root, hub, maxParallel: 1 });
  vi.spyOn(jobs, "enqueue").mockImplementation((kind, _input, meta) => ({
    id: crypto.randomUUID(),
    kind,
    ...meta,
    status: "queued",
    progress: "",
    startedAt: null,
    finishedAt: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
    billing: "metered",
  }));
  const store = new PlanKickoffs({ root, hub, jobs, file: defaultPlanKickoffsFile(root) });
  stores.push(store);
  const finish = (id: string, status: "done" | "failed" | "cancelled", sourceId?: string) => {
    hub.publish({
      type: "job",
      job: {
        id,
        status,
        finishedAt: new Date().toISOString(),
        ...(sourceId ? { result: { sourceId } } : {}),
      } as JobView,
    });
  };
  return { hub, jobs, store, finish };
}
async function addSource(id: string) {
  await fs.mkdir(path.join(root, "library", id), { recursive: true });
  await fs.writeFile(path.join(root, "library", id, "source.md"), "# Source\n");
}
async function emptyPlan() {
  const file = path.join(root, set, "PLAN.md");
  await fs.writeFile(file, (await fs.readFile(file, "utf8")).replace(/sources: \[[^\n]*\]/, "sources: []"));
}

describe("PlanKickoffs", () => {
  it("waits for every ingest, then drafts with successful IDs and current plan sources only once", async () => {
    const { store, jobs, finish } = harness();
    const ids = store.start(set, urls, chapters);
    expect(jobs.enqueue).toHaveBeenCalledTimes(2);
    await addSource("lib-new");
    finish(ids[0] as string, "done", "lib-new");
    await Promise.resolve();
    expect(jobs.enqueue).toHaveBeenCalledTimes(2);
    finish(ids[1] as string, "failed");
    finish(ids[1] as string, "failed");
    await vi.waitFor(() => expect(jobs.enqueue).toHaveBeenCalledTimes(3));
    expect(jobs.enqueue).toHaveBeenLastCalledWith(
      "plan-set",
      expect.objectContaining({ mediaOnly: true }),
      expect.anything(),
    );
    const mediaId = vi.mocked(jobs.enqueue).mock.results.at(-1)?.value.id as string;
    finish(mediaId, "done");
    await vi.waitFor(() => expect(jobs.enqueue).toHaveBeenCalledTimes(4));
    expect(jobs.enqueue).toHaveBeenLastCalledWith(
      "draft-chapter",
      { set, ...chapters[0], sources: ["lib-new", "lib-strang-la"] },
      { set, title: "Vectors" },
    );
    await expect(fs.access(defaultPlanKickoffsFile(root))).rejects.toThrow();
  });

  it("reloads settled results and re-enqueues only unfinished ingests after restart", async () => {
    await emptyPlan();
    const first = harness();
    const ids = first.store.start(set, urls, chapters);
    await addSource("lib-one");
    first.finish(ids[0] as string, "done", "lib-one");
    first.store.dispose();
    const second = harness();
    await second.store.resume();
    expect(second.jobs.enqueue).toHaveBeenCalledTimes(1);
    expect(second.jobs.enqueue).toHaveBeenCalledWith("ingest", { url: urls[1], set }, { set, title: "two" });
    const newId = vi.mocked(second.jobs.enqueue).mock.results[0]?.value.id as string;
    await addSource("lib-two");
    second.finish(newId, "done", "lib-two");
    await vi.waitFor(() => expect(second.jobs.enqueue).toHaveBeenCalledTimes(2));
    const mediaId = vi.mocked(second.jobs.enqueue).mock.results.at(-1)?.value.id as string;
    second.finish(mediaId, "done");
    await vi.waitFor(() => expect(second.jobs.enqueue).toHaveBeenCalledTimes(3));
    expect(second.jobs.enqueue).toHaveBeenLastCalledWith(
      "draft-chapter",
      { set, ...chapters[0], sources: ["lib-one", "lib-two"] },
      { set, title: "Vectors" },
    );
  });

  it("keeps an Activity failure across restart when all ingests fail and there are no sources", async () => {
    await emptyPlan();
    const first = harness();
    const ids = first.store.start(set, urls, chapters);
    first.finish(ids[0] as string, "failed");
    first.finish(ids[1] as string, "cancelled");
    await vi.waitFor(() => expect(first.jobs.list()).toHaveLength(1));
    expect(first.jobs.enqueue).toHaveBeenCalledTimes(2);
    expect(first.jobs.list()[0]).toMatchObject({
      kind: "plan-set",
      status: "failed",
      error: expect.stringContaining("Couldn't add any of the plan's sources"),
      usage: { costUsd: 0 },
    });
    first.store.dispose();
    const second = harness();
    await second.store.resume();
    expect(second.jobs.enqueue).not.toHaveBeenCalled();
    expect(second.jobs.list()[0]?.error).toContain("Couldn't add any of the plan's sources");
  });

  it("drafts using existing plan sources even when every proposed ingest fails", async () => {
    const { store, jobs, finish } = harness();
    const ids = store.start(set, urls, chapters);
    for (const id of ids) finish(id, "failed");
    await vi.waitFor(() => expect(jobs.enqueue).toHaveBeenCalledTimes(3));
    expect(jobs.enqueue).toHaveBeenLastCalledWith(
      "plan-set",
      expect.objectContaining({ mediaOnly: true }),
      expect.anything(),
    );
    const mediaId = vi.mocked(jobs.enqueue).mock.results.at(-1)?.value.id as string;
    finish(mediaId, "done");
    await vi.waitFor(() => expect(jobs.enqueue).toHaveBeenCalledTimes(4));
    expect(jobs.enqueue).toHaveBeenLastCalledWith(
      "draft-chapter",
      { set, ...chapters[0], sources: ["lib-strang-la"] },
      { set, title: "Vectors" },
    );
  });

  it("records AI revocation during kickoff without an unhandled completion failure", async () => {
    const { store, jobs, finish } = harness();
    const ids = store.start(set, urls, chapters);
    vi.mocked(jobs.enqueue).mockImplementation(() => {
      throw new AiDisabledError();
    });
    for (const id of ids) finish(id, "failed");
    await vi.waitFor(() => expect(jobs.list()[0]?.error).toBe("AI features are disabled for this account"));
  });

  it("completes with a single runner slot without putting the wait in the runner", async () => {
    const hub = new EventHub();
    const jobs = new JobRunner({ root, hub, maxParallel: 1 });
    const ingested: string[] = [];
    const drafted: unknown[] = [];
    jobs.register("ingest", async (input) => {
      ingested.push((input as { url: string }).url);
      return { sourceId: "lib-strang-la" };
    });
    jobs.register("plan-set", async () => ({}));
    jobs.register("draft-chapter", async (input) => {
      drafted.push(input);
      return undefined;
    });
    const store = new PlanKickoffs({ root, hub, jobs, file: defaultPlanKickoffsFile(root) });
    stores.push(store);
    store.start(set, urls, chapters);
    await vi.waitFor(() => expect(drafted).toHaveLength(1));
    expect(ingested).toEqual(urls);
    expect(jobs.list().filter((job) => job.kind === "draft-chapter")).toHaveLength(1);
  });
});
