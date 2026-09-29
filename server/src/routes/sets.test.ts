import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { StudiumEvent } from "@studium/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventHub } from "../events.js";
import { ensureRepo, log } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { setsRoutes } from "./sets.js";

describe("sets authoring routes", () => {
  let root: string;
  let outside: string;
  let app: Hono;
  let hub: EventHub;
  let events: StudiumEvent[];

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-sets-routes-"));
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "studium-sets-outside-"));
    await fs.mkdir(path.join(root, "alpha/notes"), { recursive: true });
    await fs.mkdir(path.join(root, "alpha/cards"), { recursive: true });
    await fs.mkdir(path.join(root, "alpha/log"), { recursive: true });
    await fs.writeFile(
      path.join(root, "alpha/PLAN.md"),
      '---\ntitle: "Alpha"\nstatus: active\nlevel: 1\nsources: []\nnext_action: Start\n---\n',
    );
    await fs.writeFile(
      path.join(root, "alpha/notes/03-vectors.md"),
      "---\ntitle: Vectors\norder: 3\n---\n\n# Vectors\n",
    );
    await ensureRepo(root);

    hub = new EventHub();
    events = [];
    hub.subscribe((event) => events.push(event));
    app = new Hono();
    app.route("/api/sets", setsRoutes({ root, hub, locks: new FileLocks() }));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(outside, { recursive: true, force: true });
  });

  async function json(pathname: string, method: "POST" | "PUT", body: unknown): Promise<Response> {
    return await app.request(pathname, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  function commitEvents() {
    return events.filter((event) => event.type === "commit");
  }

  it("creates a set, commits it as user, and publishes the commit", async () => {
    const response = await json("/api/sets", "POST", { title: "  Alpha  ", goal: "Understand alpha" });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ slug: "alpha-2" });
    await expect(fs.readFile(path.join(root, "alpha-2/PLAN.md"), "utf8")).resolves.toBe(
      '---\ntitle: "Alpha"\nstatus: active\nlevel: 1\nsources: []\nnext_action: Add a source, then start a chapter\n---\n\n## Goal\n\nUnderstand alpha\n',
    );
    await expect(fs.readdir(path.join(root, "alpha-2"))).resolves.toEqual(
      expect.arrayContaining(["PLAN.md", "notes", "cards", "log"]),
    );
    const [commit] = await log(root, { limit: 1 });
    expect(commit).toMatchObject({ author: "user", subject: "user: create set Alpha" });
    expect(commitEvents()).toEqual([
      { type: "commit", sha: commit?.sha, subject: "user: create set Alpha", author: "user" },
    ]);
  });

  it("validates create-set bodies", async () => {
    expect((await json("/api/sets", "POST", { title: " " })).status).toBe(400);
    expect((await json("/api/sets", "POST", { title: "x".repeat(121) })).status).toBe(400);
    expect((await json("/api/sets", "POST", { title: "Valid", goal: "x".repeat(2001) })).status).toBe(400);
    expect((await json("/api/sets", "POST", { title: "Valid", goal: 1 })).status).toBe(400);
  });

  it("creates the next numbered note, commits it, and publishes the commit", async () => {
    await fs.writeFile(path.join(root, "alpha/notes/09-existing.md"), "# Existing\n");
    const response = await json("/api/sets/alpha/notes", "POST", { title: "  Inner Products  " });

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toEqual({ path: "notes/10-inner-products.md" });
    await expect(fs.readFile(path.join(root, "alpha/notes/10-inner-products.md"), "utf8")).resolves.toBe(
      '---\ntitle: "Inner Products"\norder: 10\n---\n\n# Inner Products\n\n',
    );
    const [commit] = await log(root, { limit: 1 });
    expect(commit).toMatchObject({ author: "user", subject: "user: create note Inner Products" });
    expect(commitEvents()).toEqual([
      { type: "commit", sha: commit?.sha, subject: "user: create note Inner Products", author: "user" },
    ]);
  });

  it("validates create-note bodies and returns 404 for an unknown set", async () => {
    expect((await json("/api/sets/alpha/notes", "POST", { title: "" })).status).toBe(400);
    expect((await json("/api/sets/alpha/notes", "POST", { title: "x".repeat(121) })).status).toBe(400);
    expect((await json("/api/sets/missing/notes", "POST", { title: "Valid" })).status).toBe(404);
  });

  it("replaces a note, commits its title, and publishes the commit", async () => {
    const rel = "alpha/notes/03-vectors.md";
    const previous = await fs.readFile(path.join(root, rel), "utf8");
    const content = "---\ntitle: Vector Spaces\norder: 3\n---\n\n# Vector Spaces\n";
    const response = await json("/api/sets/alpha/file", "PUT", {
      path: "notes/03-vectors.md",
      content,
      previous,
    });

    expect(response.status).toBe(200);
    const body = (await response.json()) as { sha: string };
    expect(body.sha).toMatch(/^[0-9a-f]{40}$/);
    await expect(fs.readFile(path.join(root, rel), "utf8")).resolves.toBe(content);
    expect((await log(root, { limit: 1 }))[0]).toMatchObject({
      sha: body.sha,
      author: "user",
      subject: "user: edit Vector Spaces",
    });
    expect(commitEvents()).toEqual([
      { type: "commit", sha: body.sha, subject: "user: edit Vector Spaces", author: "user" },
    ]);
  });

  it("returns conflict, missing, and unchanged PUT results without spurious commits", async () => {
    const current = await fs.readFile(path.join(root, "alpha/notes/03-vectors.md"), "utf8");
    const conflict = await json("/api/sets/alpha/file", "PUT", {
      path: "notes/03-vectors.md",
      content: "new",
      previous: "stale",
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toEqual({ error: "changed", current });

    const missing = await json("/api/sets/alpha/file", "PUT", {
      path: "notes/missing.md",
      content: "new",
      previous: "old",
    });
    expect(missing.status).toBe(404);

    const unchanged = await json("/api/sets/alpha/file", "PUT", {
      path: "notes/03-vectors.md",
      content: current,
      previous: current,
    });
    expect(unchanged.status).toBe(200);
    await expect(unchanged.json()).resolves.toEqual({ sha: null });
    expect(commitEvents()).toEqual([]);
  });

  it("rejects invalid paths, oversized content, and symlink escapes", async () => {
    const current = await fs.readFile(path.join(root, "alpha/notes/03-vectors.md"), "utf8");
    for (const invalid of ["../PLAN.md", "notes/../PLAN.md", "cards/x.md", "/tmp/x.md"]) {
      expect(
        (
          await json("/api/sets/alpha/file", "PUT", {
            path: invalid,
            content: current,
            previous: current,
          })
        ).status,
      ).toBe(400);
    }

    expect(
      (
        await json("/api/sets/alpha/file", "PUT", {
          path: "notes/03-vectors.md",
          content: "x".repeat(1024 * 1024 + 1),
          previous: current,
        })
      ).status,
    ).toBe(413);

    await fs.mkdir(path.join(root, "linked"));
    await fs.writeFile(path.join(root, "linked/PLAN.md"), "---\ntitle: Linked\nstatus: active\n---\n");
    await fs.writeFile(path.join(outside, "escape.md"), "secret\n");
    await fs.symlink(outside, path.join(root, "linked/notes"));
    const escaped = await json("/api/sets/linked/file", "PUT", {
      path: "notes/escape.md",
      content: "changed\n",
      previous: "secret\n",
    });
    expect(escaped.status).toBe(400);
    await expect(fs.readFile(path.join(outside, "escape.md"), "utf8")).resolves.toBe("secret\n");
  });
});
