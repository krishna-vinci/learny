import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createNote, createSet, slugify, writeNoteAsUser } from "./authoring.js";
import type { EditError } from "./edit.js";
import { ensureRepo, log } from "./git.js";
import { FileLocks } from "./lock.js";

describe("authoring", () => {
  let root: string;
  let locks: FileLocks;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-authoring-"));
    locks = new FileLocks();
    await ensureRepo(root);
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("slugifies titles and creates uniquely named set trees", async () => {
    expect(slugify("  Systems & Signals! ", 40)).toBe("systems-signals");
    expect(slugify("!!!", 40)).toBe("set");

    const first = await createSet(root, { title: "Library", goal: "Learn signal processing" });
    const second = await createSet(root, { title: "Library" });
    expect(first.slug).toBe("library-2");
    expect(second.slug).toBe("library-3");
    await expect(fs.readFile(path.join(root, first.slug, "PLAN.md"), "utf8")).resolves.toContain(
      "## Goal\n\nLearn signal processing\n",
    );
    await expect(fs.readdir(path.join(root, first.slug))).resolves.toEqual(
      expect.arrayContaining(["PLAN.md", "notes", "cards", "log"]),
    );
    expect((await log(root, { limit: 1 }))[0]).toMatchObject({
      author: "user",
      subject: "user: create set Library",
    });
  });

  it("creates the next numbered note and commits only that note", async () => {
    await createSet(root, { title: "Linear Algebra" });
    await fs.writeFile(path.join(root, "linear-algebra/notes/07-existing.md"), "# Existing\n");

    const result = await createNote(root, locks, "linear-algebra", "Vector Spaces");
    expect(result.path).toBe("notes/08-vector-spaces.md");
    await expect(fs.readFile(path.join(root, "linear-algebra", result.path), "utf8")).resolves.toBe(
      '---\ntitle: "Vector Spaces"\norder: 8\n---\n\n# Vector Spaces\n\n',
    );
    expect((await log(root, { limit: 1 }))[0]).toMatchObject({
      author: "user",
      subject: "user: create note Vector Spaces",
    });
  });

  it("quotes titles with YAML syntax so the frontmatter still parses", async () => {
    const set = await createSet(root, { title: "SVD: intuition\n# first" });
    const note = await createNote(root, locks, set.slug, "Rank: 'why' #1");
    const { parseFrontmatter } = await import("@studium/shared");
    const plan = await fs.readFile(path.join(root, set.slug, "PLAN.md"), "utf8");
    expect(parseFrontmatter(plan).frontmatter.title).toBe("SVD: intuition # first");
    const text = await fs.readFile(path.join(root, set.slug, note.path), "utf8");
    expect(parseFrontmatter(text).frontmatter.title).toBe("Rank: 'why' #1");
  });

  it("writes a note with compare-and-swap semantics and commits as the user", async () => {
    await createSet(root, { title: "Linear Algebra" });
    const created = await createNote(root, locks, "linear-algebra", "Vectors");
    const rel = `linear-algebra/${created.path}`;
    const previous = await fs.readFile(path.join(root, rel), "utf8");
    const content = previous.replace("Vectors", "Vector Geometry");

    const result = await writeNoteAsUser(root, locks, rel, content, previous);
    expect(result.sha).toMatch(/^[0-9a-f]{40}$/);
    expect((await log(root, { limit: 1 }))[0]).toMatchObject({
      author: "user",
      subject: "user: edit Vector Geometry",
    });
    await expect(writeNoteAsUser(root, locks, rel, content, previous)).rejects.toMatchObject<Partial<EditError>>({
      code: "conflict",
      current: content,
    });
  });
});
