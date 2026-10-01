import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { JobView, StudiumEvent } from "@studium/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventHub } from "../events.js";
import { AiDisabledError } from "../jobs/runner.js";
import { SiteImportQueue } from "./site-queue.js";

const SAMPLE_SET = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));

let root: string;
let file: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-site-queue-"));
  await fs.cp(SAMPLE_SET, root, { recursive: true });
  file = path.join(root, ".cache", "site-import-queue.json");
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

function harness() {
  const hub = new EventHub();
  const enqueued: { id: string; url: string }[] = [];
  const jobs = {
    enqueue: (_kind: string, input: unknown) => {
      const id = `job-${enqueued.length + 1}`;
      enqueued.push({ id, url: (input as { url: string }).url });
      return { id } as JobView;
    },
  };
  const finish = (id: string) =>
    hub.publish({ type: "job", job: { id, finishedAt: new Date().toISOString() } as JobView } as StudiumEvent);
  return { hub, jobs, enqueued, finish };
}

const urls = (count: number) => Array.from({ length: count }, (_, index) => `https://docs.example.com/page-${index}`);

describe("SiteImportQueue", () => {
  it("drops the waiting pages when AI is turned off mid-import", () => {
    const { hub, jobs, enqueued, finish } = harness();
    let allowed = true;
    const gated = {
      enqueue: (kind: string, input: unknown) => {
        if (!allowed) throw new AiDisabledError();
        return jobs.enqueue(kind, input);
      },
    };
    const queue = new SiteImportQueue({ root, hub, jobs: gated, file });
    queue.enqueue(urls(6), "linear-algebra");
    expect(enqueued).toHaveLength(3);
    allowed = false;
    expect(() => finish("job-1")).not.toThrow();
    finish("job-2");
    finish("job-3");
    expect(enqueued).toHaveLength(3);
    expect(queue.pending).toBe(0);
  });

  it("keeps three ingest jobs outstanding and releases the next as each finishes", () => {
    const { hub, jobs, enqueued, finish } = harness();
    const queue = new SiteImportQueue({ root, hub, jobs });
    queue.enqueue(urls(5), "linear-algebra");
    expect(enqueued).toHaveLength(3);
    finish("job-1");
    expect(enqueued).toHaveLength(4);
    finish("job-2");
    finish("job-3");
    finish("job-4");
    expect(enqueued).toHaveLength(5);
    finish("job-5");
    expect(queue.pending).toBe(0);
  });

  it("persists waiting and in-flight URLs and removes the file when done", async () => {
    const { hub, jobs, finish } = harness();
    const queue = new SiteImportQueue({ root, hub, jobs, file });
    queue.enqueue(urls(4), null);
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toHaveLength(4);
    for (const id of ["job-1", "job-2", "job-3", "job-4"]) finish(id);
    await expect(fs.access(file)).rejects.toThrow();
  });

  it("resumes unfinished imports after a restart, skipping pages already in the library", async () => {
    const first = harness();
    const queue = new SiteImportQueue({ root, hub: first.hub, jobs: first.jobs, file });
    queue.enqueue(urls(5), "linear-algebra");
    queue.dispose();

    // The library already holds page-2; a restart must not import it again.
    await fs.mkdir(path.join(root, "library/lib-page-2"), { recursive: true });
    await fs.writeFile(
      path.join(root, "library/lib-page-2/source.md"),
      "---\nid: lib-page-2\ntitle: Page 2\nauthors: []\ntype: article\nurl: https://docs.example.com/page-2\ncredibility: C\nparse_tier: basic\nadded: 2026-10-01\n---\n\nBody\n",
    );

    const second = harness();
    const restarted = new SiteImportQueue({ root, hub: second.hub, jobs: second.jobs, file });
    await expect(restarted.resume()).resolves.toBe(4);
    expect(second.enqueued.map((job) => job.url)).toEqual([urls(5)[0], urls(5)[1], urls(5)[3]]);
    expect(restarted.pending).toBe(4);
  });
});
