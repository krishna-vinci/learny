import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StudiumEvent } from "@studium/shared";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EventHub } from "./events.js";
import { startWatcher } from "./watcher.js";

const NOTE = "linear-algebra/notes/03-svd.md";

let root: string;
let stop: (() => Promise<void>) | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function write(rel: string, text: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, text);
}

async function collect(): Promise<{ hub: EventHub; events: StudiumEvent[] }> {
  const hub = new EventHub();
  const events: StudiumEvent[] = [];
  hub.subscribe((event) => events.push(event));
  stop = startWatcher(root, hub);
  // chokidar scans the tree first; ignoreInitial suppresses those events.
  await sleep(500);
  return { hub, events };
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-watch-"));
  await write(NOTE, "original\n");
});

afterEach(async () => {
  await stop?.();
  stop = null;
  await fs.rm(root, { recursive: true, force: true });
});

describe("startWatcher", () => {
  it("publishes one file event, tagged with the set, when a note changes", async () => {
    const { events } = await collect();

    await write(NOTE, "changed\n");

    await vi.waitFor(
      () => {
        expect(events.some((event) => event.type === "file" && event.path === NOTE)).toBe(true);
      },
      { timeout: 5_000 },
    );

    expect(events.filter((event) => event.type === "file")).toEqual([
      { type: "file", set: "linear-algebra", path: NOTE, change: "change" },
    ]);
  });

  it("tags paths outside any set with set null", async () => {
    await write("_global/config.yaml", "models: {}\n");
    const { events } = await collect();

    await write("_global/config.yaml", "models: { default: x }\n");

    await vi.waitFor(
      () => {
        expect(events.some((event) => event.type === "file" && event.path === "_global/config.yaml")).toBe(true);
      },
      { timeout: 5_000 },
    );

    const event = events.find((candidate) => candidate.type === "file" && candidate.path === "_global/config.yaml");
    expect(event).toEqual({ type: "file", set: null, path: "_global/config.yaml", change: "change" });
  });

  it("ignores .git, .cache, and chats directories", async () => {
    await write("linear-algebra/chats/.keep", "");
    const { events } = await collect();

    await write(".git/HEAD", "ref: refs/heads/main\n");
    await write(".cache/index.json", "{}\n");
    await write("linear-algebra/chats/session.json", "{}\n");
    await write(NOTE, "after\n");

    await vi.waitFor(
      () => {
        expect(events.some((event) => event.type === "file" && event.path === NOTE)).toBe(true);
      },
      { timeout: 5_000 },
    );

    const paths = events.map((event) => (event.type === "file" ? event.path : ""));
    expect(paths).toContain(NOTE);
    expect(paths).not.toContain(".git/HEAD");
    expect(paths).not.toContain(".cache/index.json");
    expect(paths).not.toContain("linear-algebra/chats/session.json");
  });
});
