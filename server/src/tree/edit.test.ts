import { mkdir, mkdtemp, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFile, EditError, editFile, readText, replaceFile } from "./edit";
import { FileLocks } from "./lock";

describe("edit", () => {
  let root: string;
  let locks: FileLocks;
  const noteRel = "linear-algebra/notes/a.md";
  const noteAbs = () => path.join(root, noteRel);

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "studium-edit-"));
    locks = new FileLocks();
    await mkdir(path.dirname(noteAbs()), { recursive: true });
    await writeFile(noteAbs(), "# Title\n\nunique line\nshared line\nshared line\n");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("replaces a single exact match and writes atomically", async () => {
    const result = await editFile(root, locks, "agent", noteRel, "unique line", "edited line");
    expect(result).toEqual({ replacements: 1 });
    expect(await readText(root, noteRel)).toBe("# Title\n\nedited line\nshared line\nshared line\n");

    const files = await readdir(path.dirname(noteAbs()));
    expect(files).toEqual(["a.md"]);
  });

  it("reports no_match when the old string is absent", async () => {
    const error = await editFile(root, locks, "agent", noteRel, "absent", "new").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(EditError);
    expect((error as EditError).code).toBe("no_match");
  });

  it("reports multiple_matches unless replaceAll is set", async () => {
    await expect(editFile(root, locks, "agent", noteRel, "shared line", "new")).rejects.toMatchObject({
      name: "EditError",
      code: "multiple_matches",
    });

    const result = await editFile(root, locks, "agent", noteRel, "shared line", "new line", {
      replaceAll: true,
    });
    expect(result).toEqual({ replacements: 2 });
    expect(await readText(root, noteRel)).toBe("# Title\n\nunique line\nnew line\nnew line\n");
  });

  it("reports not_found for a missing file", async () => {
    await expect(editFile(root, locks, "agent", "linear-algebra/notes/missing.md", "a", "b")).rejects.toMatchObject({
      name: "EditError",
      code: "not_found",
    });
  });

  it("replaces a whole file only when its expected content is current", async () => {
    const original = await readText(root, noteRel);
    await replaceFile(root, locks, "user", noteRel, "# Updated\n", original);
    await expect(readText(root, noteRel)).resolves.toBe("# Updated\n");

    await expect(replaceFile(root, locks, "user", noteRel, "# Stale\n", original)).rejects.toMatchObject({
      name: "EditError",
      code: "conflict",
      current: "# Updated\n",
    });
  });

  it("reports not_found when replacing a missing file", async () => {
    await expect(
      replaceFile(root, locks, "user", "linear-algebra/notes/missing.md", "new", "old"),
    ).rejects.toMatchObject({ name: "EditError", code: "not_found" });
  });

  it("rejects identical old and new strings", async () => {
    await expect(editFile(root, locks, "agent", noteRel, "unique line", "unique line")).rejects.toThrow(
      "oldString and newString must be different",
    );
  });

  it("rejects paths outside the agent write allowlist", async () => {
    await expect(editFile(root, locks, "agent", "linear-algebra/PLAN.md", "a", "b")).rejects.toMatchObject({
      name: "EditError",
      code: "forbidden",
    });
    await expect(createFile(root, locks, "agent", "linear-algebra/PLAN.md", "content")).rejects.toMatchObject({
      name: "EditError",
      code: "forbidden",
    });
  });

  it("rejects writing through an in-root notes symlink to chats", async () => {
    const linkedSet = path.join(root, "linked-set");
    const chats = path.join(linkedSet, "chats");
    await mkdir(chats, { recursive: true });
    await symlink(chats, path.join(linkedSet, "notes"));

    await expect(createFile(root, locks, "agent", "linked-set/notes/private.md", "secret\n")).rejects.toMatchObject({
      name: "EditError",
      code: "forbidden",
    });
    await expect(readFileOrNull(path.join(chats, "private.md"))).resolves.toBeNull();
  });

  it("supports a custom write policy while the default still forbids the same path", async () => {
    const sourceRel = "library/x/source.md";
    const canWriteSource = (rel: string) => rel === sourceRel;

    await createFile(root, locks, "librarian", sourceRel, "pending summary\n", { canWrite: canWriteSource });
    await expect(
      editFile(root, locks, "librarian", sourceRel, "pending summary", "trusted summary", {
        canWrite: canWriteSource,
      }),
    ).resolves.toEqual({ replacements: 1 });
    await expect(readText(root, sourceRel)).resolves.toBe("trusted summary\n");

    await expect(editFile(root, locks, "agent", sourceRel, "trusted", "changed")).rejects.toMatchObject({
      name: "EditError",
      code: "forbidden",
    });
  });

  it("rejects traversal and .git paths as forbidden edits", async () => {
    await expect(editFile(root, locks, "agent", "../outside.md", "a", "b")).rejects.toMatchObject({
      name: "EditError",
      code: "forbidden",
    });
    await expect(editFile(root, locks, "agent", ".git/config", "a", "b")).rejects.toMatchObject({
      name: "EditError",
      code: "forbidden",
    });
  });

  it("creates a new file with parent directories", async () => {
    const rel = "linear-algebra/log/session/2026-09-28.md";
    await createFile(root, locks, "agent", rel, "# Session\n");
    expect(await readText(root, rel)).toBe("# Session\n");

    await expect(createFile(root, locks, "agent", rel, "again")).rejects.toMatchObject({
      name: "EditError",
      code: "exists",
    });
  });

  it("readText reports not_found for missing files", async () => {
    await expect(readText(root, "linear-algebra/notes/missing.md")).rejects.toMatchObject({
      name: "EditError",
      code: "not_found",
    });
  });
});

async function readFileOrNull(file: string): Promise<string | null> {
  try {
    return await readFile(file, "utf8");
  } catch {
    return null;
  }
}
