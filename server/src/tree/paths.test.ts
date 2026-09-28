import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { isWritableByAgent, PathError, resolveInRoot } from "./paths";

describe("resolveInRoot", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "studium-paths-"));
    await mkdir(path.join(root, "linear-algebra", "notes"), { recursive: true });
    await writeFile(path.join(root, "linear-algebra", "notes", "x.md"), "content\n");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resolves a normal nested path inside the root", () => {
    const rel = "linear-algebra/notes/x.md";
    expect(resolveInRoot(root, rel)).toBe(path.resolve(root, rel));
  });

  it("resolves a path whose parent directories do not exist yet", () => {
    const rel = "linear-algebra/notes/new/deep/note.md";
    expect(resolveInRoot(root, rel)).toBe(path.resolve(root, rel));
  });

  it("rejects an empty path", () => {
    expect(() => resolveInRoot(root, "")).toThrow(PathError);
  });

  it("rejects absolute paths", () => {
    expect(() => resolveInRoot(root, "/etc/passwd")).toThrow(PathError);
  });

  it("rejects NUL bytes", () => {
    expect(() => resolveInRoot(root, "linear-algebra/notes/x\u0000.md")).toThrow(PathError);
  });

  it("rejects any .. segment", () => {
    expect(() => resolveInRoot(root, "linear-algebra/../escape.txt")).toThrow(PathError);
    expect(() => resolveInRoot(root, "linear-algebra/notes/../x.md")).toThrow(PathError);
  });

  it("rejects .git and .cache as the first segment", () => {
    expect(() => resolveInRoot(root, ".git/config")).toThrow(PathError);
    expect(() => resolveInRoot(root, ".cache/lock")).toThrow(PathError);
  });

  it("rejects a symlinked directory that points outside the root", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "studium-outside-"));
    try {
      await mkdir(path.join(outside, "secret"), { recursive: true });
      await writeFile(path.join(outside, "secret", "file.txt"), "secret\n");
      await symlink(path.join(outside, "secret"), path.join(root, "link"));
      expect(() => resolveInRoot(root, "link/file.txt")).toThrow(PathError);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("rejects a symlinked file that points outside the root", async () => {
    const outside = await mkdtemp(path.join(tmpdir(), "studium-outside-"));
    try {
      const target = path.join(outside, "secret.txt");
      await writeFile(target, "secret\n");
      await symlink(target, path.join(root, "linear-algebra", "notes", "linked.md"));
      expect(() => resolveInRoot(root, "linear-algebra/notes/linked.md")).toThrow(PathError);
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  });

  it("accepts a symlink that stays inside the root", async () => {
    await symlink(
      path.join(root, "linear-algebra", "notes", "x.md"),
      path.join(root, "linear-algebra", "notes", "alias.md"),
    );
    expect(resolveInRoot(root, "linear-algebra/notes/alias.md")).toBe(
      path.resolve(root, "linear-algebra", "notes", "alias.md"),
    );
  });
});

describe("isWritableByAgent", () => {
  it("allows files under notes and log of a normal set", () => {
    expect(isWritableByAgent("linear-algebra/notes/x.md")).toBe(true);
    expect(isWritableByAgent("linear-algebra/log/decisions.md")).toBe(true);
    expect(isWritableByAgent("linear-algebra/notes/sub/deep/note.md")).toBe(true);
  });

  it("rejects paths outside the notes/log allowlist", () => {
    expect(isWritableByAgent("_global/config.yaml")).toBe(false);
    expect(isWritableByAgent("library/notes/x.md")).toBe(false);
    expect(isWritableByAgent("linear-algebra/PLAN.md")).toBe(false);
    expect(isWritableByAgent("linear-algebra/notes")).toBe(false);
  });

  it("rejects empty, absolute, and traversal paths", () => {
    expect(isWritableByAgent("")).toBe(false);
    expect(isWritableByAgent("/etc/passwd")).toBe(false);
    expect(isWritableByAgent("../linear-algebra/notes/x.md")).toBe(false);
    expect(isWritableByAgent("linear-algebra/notes/../notes/x.md")).toBe(false);
    expect(isWritableByAgent("linear-algebra/notes//x.md")).toBe(false);
  });
});
