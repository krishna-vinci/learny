import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventHub } from "../events.js";
import { JobRunner } from "../jobs/runner.js";
import { INBOX_DIR, startInboxWatcher } from "./inbox-watcher.js";
import type { IngestJobInput } from "./library.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let root: string;
let jobs: JobRunner;
let received: IngestJobInput[];
let stop: (() => Promise<void>) | null = null;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-inbox-"));
  received = [];
  jobs = new JobRunner({ root, hub: new EventHub(), maxParallel: 2 });
  jobs.register("ingest", async (input) => {
    received.push(input as IngestJobInput);
    return { sourceId: "lib-stub" };
  });
});

afterEach(async () => {
  await stop?.();
  stop = null;
  await fs.rm(root, { recursive: true, force: true });
});

async function start(): Promise<void> {
  stop = startInboxWatcher({ root, jobs });
  // chokidar attaches its watchers asynchronously; let it settle before dropping.
  await sleep(500);
}

describe("startInboxWatcher", () => {
  it("picks up a dropped file and enqueues an ingest job, leaving the file for the job to remove", async () => {
    await start();

    const file = path.join(root, INBOX_DIR, "notes.md");
    await fs.writeFile(file, "# Dropped\n\nhello\n");

    await vi.waitFor(() => expect(received).toHaveLength(1), { timeout: 5_000 });
    expect(received[0]?.filename).toBe("notes.md");
    expect(received[0]?.set).toBeNull();
    expect(new TextDecoder().decode(received[0]?.bytes)).toContain("# Dropped");
    expect(received[0]?.inboxPath).toBe(`${INBOX_DIR}/notes.md`);
    expect(existsSync(file)).toBe(true);
  });

  it("ignores an empty drop instead of enqueuing an empty ingest", async () => {
    await start();

    const file = path.join(root, INBOX_DIR, "empty.txt");
    await fs.writeFile(file, "");

    await vi.waitFor(() => expect(existsSync(file)).toBe(false), { timeout: 5_000 });
    expect(received).toHaveLength(0);
  });
});
