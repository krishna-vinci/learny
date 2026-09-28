import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CommitInfo, StudiumEvent } from "@studium/shared";
import type { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { hashPassword } from "./auth/password.js";
import type { AuthConfig } from "./auth/session.js";
import { EventHub } from "./events.js";
import { commitAll, ensureRepo } from "./tree/git.js";
import { FileLocks } from "./tree/lock.js";

const SAMPLE_SET = fileURLToPath(new URL("../../examples/sample-set", import.meta.url));
const PASSWORDLESS: AuthConfig = { username: null, passwordHash: null, sessionSecret: null, apiToken: null };

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

function makeApp(options: { auth?: AuthConfig; hub?: EventHub } = {}): Hono {
  return createApp({
    root,
    hub: options.hub ?? new EventHub(),
    locks: new FileLocks(),
    auth: options.auth ?? PASSWORDLESS,
  });
}

function noteAbs(): string {
  return path.join(root, "linear-algebra/notes/03-svd.md");
}

describe("createApp sets routes", () => {
  it("lists the sample set", async () => {
    const response = await makeApp().request("/api/sets");

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
    const response = await makeApp().request("/api/sets/linear-algebra/notes");

    expect(response.status).toBe(200);
    const notes = (await response.json()) as { path: string }[];
    expect(notes.map((note) => note.path)).toEqual(["notes/01-vectors.md", "notes/02-matrices.md", "notes/03-svd.md"]);
  });

  it("returns frontmatter and body for a note", async () => {
    const response = await makeApp().request(`/api/sets/linear-algebra/file?path=notes/03-svd.md`);

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
      const response = await app.request(`/api/sets/linear-algebra/file?path=${encodeURIComponent(attempt)}`);
      expect([400, 404]).toContain(response.status);
      const text = await response.text();
      expect(text).not.toContain("models:");
      expect(text).not.toContain("root:");
    }
  });

  it("404s an unknown or reserved set", async () => {
    const app = makeApp();

    const unknown = await app.request("/api/sets/nope/notes");
    const reserved = await app.request("/api/sets/library/file?path=lib-strang-la/source.md");

    expect(unknown.status).toBe(404);
    await expect(unknown.json()).resolves.toEqual({ error: "not found" });
    expect(reserved.status).toBe(404);
  });

  it("requires a session for API routes once a password is configured", async () => {
    const auth: AuthConfig = {
      username: "learner",
      passwordHash: await hashPassword("study-password"),
      sessionSecret: "a-secure-session-secret-at-least-32-chars",
      apiToken: null,
    };
    const app = makeApp({ auth });

    expect((await app.request("/api/sets")).status).toBe(401);
    expect((await app.request("/api/events")).status).toBe(401);

    const login = await app.request("/api/auth/login", {
      method: "POST",
      headers: { "content-type": "application/json", "x-forwarded-for": "192.0.2.10" },
      body: JSON.stringify({ username: "learner", password: "study-password" }),
    });
    expect(login.status).toBe(204);

    const cookie = (login.headers.get("set-cookie") ?? "").split(";", 1)[0] ?? "";
    expect((await app.request("/api/sets", { headers: { cookie } })).status).toBe(200);
  });
});

describe("createApp history, diff, and revert", () => {
  it("lists history and returns a unified diff for a commit", async () => {
    await fs.appendFile(noteAbs(), "\nEdited paragraph.\n");
    const sha = await commitAll(root, "user: append paragraph", "user");
    expect(sha).not.toBeNull();

    const app = makeApp();
    const history = await app.request("/api/sets/linear-algebra/history?path=notes/03-svd.md");
    expect(history.status).toBe(200);
    const commits = (await history.json()) as CommitInfo[];
    expect(commits[0]?.sha).toBe(sha);
    expect(commits[0]?.author).toBe("user");

    const diffResponse = await app.request(`/api/sets/linear-algebra/diff?sha=${sha}&path=notes/03-svd.md`);
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

    const response = await makeApp({ hub }).request("/api/sets/linear-algebra/revert", {
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
    const response = await makeApp({ hub }).request("/api/events");

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

describe("createApp static web", () => {
  it("serves the SPA shell and falls back to index.html, but never for /api", async () => {
    const webDist = await fs.mkdtemp(path.join(os.tmpdir(), "studium-dist-"));
    tempDirs.push(webDist);
    await fs.writeFile(path.join(webDist, "index.html"), "<!doctype html><title>Studium</title>");
    await fs.writeFile(path.join(webDist, "asset.txt"), "static asset");

    const app = createApp({ root, hub: new EventHub(), locks: new FileLocks(), auth: PASSWORDLESS, webDist });

    const index = await app.request("/");
    expect(index.status).toBe(200);
    await expect(index.text()).resolves.toContain("Studium");

    const asset = await app.request("/asset.txt");
    expect(asset.status).toBe(200);
    await expect(asset.text()).resolves.toBe("static asset");

    const spaRoute = await app.request("/s/linear-algebra");
    expect(spaRoute.status).toBe(200);
    await expect(spaRoute.text()).resolves.toContain("Studium");

    const api = await app.request("/api/sets");
    expect(api.status).toBe(200);
    await expect(api.json()).resolves.toBeInstanceOf(Array);

    const missingApi = await app.request("/api/nope");
    expect(missingApi.status).toBe(404);
    await expect(missingApi.text()).resolves.not.toContain("Studium");
  });
});
