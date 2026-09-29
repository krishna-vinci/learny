import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import JSZip from "jszip";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { User } from "../accounts/users.js";
import { exportRoutes } from "./routes.js";

const SAMPLE_SET = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));
const user: User = {
  id: 1,
  username: "learner",
  displayName: "",
  email: "",
  avatarUrl: "",
  role: "USER",
  state: "NORMAL",
  aiEnabled: true,
  hasPassword: false,
  createdAt: "2026-09-29T00:00:00.000Z",
  updatedAt: "2026-09-29T00:00:00.000Z",
};

let root: string;
const dirs: string[] = [];

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-export-"));
  dirs.push(root);
  await fs.cp(SAMPLE_SET, root, { recursive: true });
  // Fixtures for the three excluded directories.
  await fs.mkdir(path.join(root, ".git"), { recursive: true });
  await fs.writeFile(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
  await fs.mkdir(path.join(root, ".cache"), { recursive: true });
  await fs.writeFile(path.join(root, ".cache", "jobs.log"), "noise\n");
  await fs.mkdir(path.join(root, "linear-algebra", "chats"), { recursive: true });
  await fs.writeFile(path.join(root, "linear-algebra", "chats", "01.md"), "chat\n");
});

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

function app(): Hono {
  const instance = new Hono();
  instance.use("*", async (c, next) => {
    c.set("user", user);
    await next();
  });
  instance.route("/api/me/export", exportRoutes({ rootFor: (username) => (username === user.username ? root : null) }));
  return instance;
}

async function names(response: Response): Promise<string[]> {
  const zip = await JSZip.loadAsync(Buffer.from(await response.arrayBuffer()));
  return Object.keys(zip.files);
}

describe("data export", () => {
  it("streams a zip of notes and PLAN.md without .git, .cache or chats", async () => {
    const response = await app().request("/api/me/export");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/zip");
    expect(response.headers.get("content-disposition")).toMatch(
      /^attachment; filename="studium-learner-\d{4}-\d{2}-\d{2}\.zip"$/,
    );

    const entries = await names(response);
    expect(entries).toContain("linear-algebra/PLAN.md");
    expect(entries).toContain("linear-algebra/notes/01-vectors.md");
    expect(entries.some((name) => name === ".git" || name.startsWith(".git/"))).toBe(false);
    expect(entries.some((name) => name === ".cache" || name.startsWith(".cache/"))).toBe(false);
    expect(entries.some((name) => name.includes("chats/"))).toBe(false);
  });

  it("includes .git only with withHistory=1", async () => {
    const entries = await names(await app().request("/api/me/export?withHistory=1"));
    expect(entries).toContain(".git/HEAD");
    expect(entries.some((name) => name.includes("chats/"))).toBe(false);
  });

  it("404s when the user's tree is missing", async () => {
    const instance = new Hono();
    instance.use("*", async (c, next) => {
      c.set("user", user);
      await next();
    });
    instance.route("/api/me/export", exportRoutes({ rootFor: () => null }));
    expect((await instance.request("/api/me/export")).status).toBe(404);
  });
});
