import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { initStudyTree } from "./init.js";

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
    expect(await fs.readFile(path.join(root, ".gitignore"), "utf8")).toBe("**/original.*\n*/chats/\n.cache/\n");
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
});
