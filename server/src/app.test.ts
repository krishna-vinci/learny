import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CommitInfo, StudiumEvent } from "@studium/shared";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { EventHub } from "./events.js";
import { commitAll, ensureRepo } from "./tree/git.js";
import { FileLocks } from "./tree/lock.js";

const SAMPLE_SET = fileURLToPath(new URL("../../examples/sample-set", import.meta.url));
let root: string;
let tempDirs: string[];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-app-"));
  tempDirs = [root];
  await fs.cp(SAMPLE_SET, root, { recursive: true });
  await ensureRepo(root);
});

afterEach(async () => {
  for (const dir of tempDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

function makeApp(options: { hub?: EventHub } = {}): Hono {
  return createApp({
    root,
    hub: options.hub ?? new EventHub(),
    locks: new FileLocks(),
  });
}

function localRequest(app: Hono, input: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set("host", "127.0.0.1:3000");
  return app.request(input, { ...init, headers });
}

function noteAbs(): string {
  return path.join(root, "linear-algebra/notes/03-svd.md");
}

describe("createApp sets routes", () => {
  it("lists the sample set", async () => {
    const response = await localRequest(makeApp(), "/api/sets");

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual([
      {
        slug: "linear-algebra",
        title: "Linear algebra for ML",
        status: "active",
        level: 1,
        deadline: "2026-12-15",
        nextAction: "Read chapter 3",
      },
    ]);
  });

  it("lists notes in order", async () => {
    const response = await localRequest(makeApp(), "/api/sets/linear-algebra/notes");

    expect(response.status).toBe(200);
    const notes = (await response.json()) as { path: string }[];
    expect(notes.map((note) => note.path)).toEqual(["notes/01-vectors.md", "notes/02-matrices.md", "notes/03-svd.md"]);
  });

  it("returns frontmatter and body for a note", async () => {
    const response = await localRequest(makeApp(), `/api/sets/linear-algebra/file?path=notes/03-svd.md`);

    expect(response.status).toBe(200);
    const view = (await response.json()) as { path: string; frontmatter: Record<string, unknown>; body: string };
    expect(view.path).toBe("notes/03-svd.md");
    expect(view.frontmatter.title).toBe("Singular value decomposition");
    expect(view.body).toContain("Eckart");
  });

  it("never returns file content for a path that escapes the set", async () => {
    const app = makeApp();
    const attempts = [
      "../_global/config.yaml",
      "notes/../../_global/config.yaml",
      "/etc/passwd",
      "..%2F..%2F_global%2Fconfig.yaml",
    ];

    for (const attempt of attempts) {
      const response = await localRequest(app, `/api/sets/linear-algebra/file?path=${encodeURIComponent(attempt)}`);
      expect([400, 404]).toContain(response.status);
      const text = await response.text();
      expect(text).not.toContain("models:");
      expect(text).not.toContain("root:");
    }
  });

  it("404s an unknown or reserved set", async () => {
    const app = makeApp();

    const unknown = await localRequest(app, "/api/sets/nope/notes");
    const reserved = await localRequest(app, "/api/sets/library/file?path=lib-strang-la/source.md");

    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toEqual({ error: "not found" });
    expect(reserved.status).toBe(404);
  });

  it("mounts the card export route", async () => {
    const response = await localRequest(makeApp(), "/api/sets/linear-algebra/export.apkg");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "no cards to export" });
  });
});

describe("createApp history, diff, and revert", () => {
  it("lists history and returns a unified diff for a commit", async () => {
    await fs.appendFile(noteAbs(), "\nEdited paragraph.\n");
    const sha = await commitAll(root, "user: append paragraph", "user");
    expect(sha).not.toBeNull();

    const app = makeApp();
    const history = await localRequest(app, "/api/sets/linear-algebra/history?path=notes/03-svd.md");
    expect(history.status).toBe(200);
    const commits = (await history.json()) as CommitInfo[];
    expect(commits[0]?.sha).toBe(sha);
    expect(commits[0]?.author).toBe("user");

    const diffResponse = await localRequest(app, `/api/sets/linear-algebra/diff?sha=${sha}&path=notes/03-svd.md`);
    expect(diffResponse.status).toBe(200);
    const { diff } = (await diffResponse.json()) as { diff: string };
    expect(diff).toContain("+Edited paragraph.");
  });

  it("reverts a commit, restores the file, and publishes a commit event", async () => {
    const hub = new EventHub();
    const events: StudiumEvent[] = [];
    hub.subscribe((event) => events.push(event));

    const before = await fs.readFile(noteAbs(), "utf8");
    await fs.appendFile(noteAbs(), "\nTemporary paragraph.\n");
    const sha = await commitAll(root, "user: temporary", "user");
    expect(sha).not.toBeNull();

    const response = await localRequest(makeApp({ hub }), "/api/sets/linear-algebra/revert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sha }),
    });

    expect(response.status).toBe(200);
    const { sha: newSha } = (await response.json()) as { sha: string };
    expect(newSha).not.toBe(sha);
    await expect(fs.readFile(noteAbs(), "utf8")).resolves.toBe(before);
    expect(events).toEqual([{ type: "commit", sha: newSha, subject: 'Revert "user: temporary"', author: "user" }]);
  });
});

describe("createApp events route", () => {
  it("streams published events as SSE", async () => {
    const hub = new EventHub();
    const response = await localRequest(makeApp({ hub }), "/api/events");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/event-stream");

    const reader = response.body?.getReader();
    expect(reader).toBeDefined();
    if (reader === undefined) return;

    const event: StudiumEvent = { type: "file", set: null, path: "_global/config.yaml", change: "change" };
    hub.publish(event);

    const chunk = await reader.read();
    const text = new TextDecoder().decode(chunk.value);
    expect(text).toContain("event: studium");
    expect(text).toContain(JSON.stringify(event));
    await reader.cancel();
  });
});
