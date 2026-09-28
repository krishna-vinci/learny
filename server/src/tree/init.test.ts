import { execFile as execFileCb } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ensureIgnores, initStudyTree, REQUIRED_IGNORES } from "./init.js";

const execFile = promisify(execFileCb);

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-init-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("initStudyTree", () => {
  it("creates the skeleton on an empty directory", async () => {
    const result = await initStudyTree(root);
    expect(result).toEqual({ created: true });

    expect(await fs.readFile(path.join(root, "_global/studium.yaml"), "utf8")).toBe("schema_version: 1\n");
    expect(await fs.readFile(path.join(root, "_global/config.yaml"), "utf8")).toContain("default: faux/echo");
    expect(await fs.readFile(path.join(root, "_global/profile.md"), "utf8")).toContain("# Learner profile");
    expect(await fs.readFile(path.join(root, ".gitignore"), "utf8")).toBe(`${REQUIRED_IGNORES.join("\n")}\n`);
  });

  it("is a no-op on an existing tree", async () => {
    await initStudyTree(root);
    await fs.writeFile(path.join(root, "_global/profile.md"), "# Custom profile\n");

    const result = await initStudyTree(root);
    expect(result).toEqual({ created: false });
    expect(await fs.readFile(path.join(root, "_global/profile.md"), "utf8")).toBe("# Custom profile\n");
  });

  it("throws when the tree records a newer schema version", async () => {
    await fs.mkdir(path.join(root, "_global"), { recursive: true });
    await fs.writeFile(path.join(root, "_global/studium.yaml"), "schema_version: 2\n");

    await expect(initStudyTree(root)).rejects.toThrow(/newer than this app supports/);
  });

  it("ensureIgnores appends missing patterns without duplicating or removing lines", async () => {
    await fs.writeFile(path.join(root, ".gitignore"), "# user\n**/original.*\n");
    await ensureIgnores(root);

    const expected = "# user\n**/original.*\n*/chats/\n.cache/\n.*.tmp-*\n";
    expect(await fs.readFile(path.join(root, ".gitignore"), "utf8")).toBe(expected);

    await ensureIgnores(root);
    expect(await fs.readFile(path.join(root, ".gitignore"), "utf8")).toBe(expected);
  });

  it("creates the ignore file on an existing tree without one", async () => {
    await fs.mkdir(path.join(root, "_global"), { recursive: true });
    await fs.writeFile(path.join(root, "_global/studium.yaml"), "schema_version: 1\n");

    const result = await initStudyTree(root);

    expect(result).toEqual({ created: false });
    expect(await fs.readFile(path.join(root, ".gitignore"), "utf8")).toBe(`${REQUIRED_IGNORES.join("\n")}\n`);
  });

  it("warns when a repaired pattern already matches tracked files", async () => {
    await execFile("git", ["-C", root, "init", "-b", "main"]);
    await fs.mkdir(path.join(root, "linear-algebra/chats"), { recursive: true });
    await fs.writeFile(path.join(root, "linear-algebra/chats/session.jsonl"), "{}\n");
    await execFile("git", ["-C", root, "-c", "commit.gpgsign=false", "add", "-A"]);
    await execFile("git", [
      "-C",
      root,
      "-c",
      "commit.gpgsign=false",
      "-c",
      "user.name=Test",
      "-c",
      "user.email=test@example.test",
      "commit",
      "-m",
      "init",
    ]);
    await fs.writeFile(path.join(root, ".gitignore"), "**/original.*\n");

    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await ensureIgnores(root);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("*/chats/"));
    } finally {
      warn.mockRestore();
    }
  });
});
