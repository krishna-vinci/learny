import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./paths.js", async () => {
  const nodePath = await import("node:path");
  return { resolveInRoot: (root: string, rel: string) => nodePath.join(root, rel) };
});

import { isSetSlug, listNotes, listSets, readSetFile } from "./read.js";

let root: string;

async function write(rel: string, text: string): Promise<void> {
  const abs = path.join(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, text);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-read-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("listSets", () => {
  it("lists set dirs with PLAN.md, skipping reserved names, sorted by slug", async () => {
    await write("_global/studium.yaml", "schema_version: 1\n");
    await write("library/lib-strang-la/source.md", "# source\n");
    await write(".cache/index.json", "{}\n");
    await write("no-plan/notes/01-x.md", "# x\n");
    await write("zeta/PLAN.md", "---\ntitle: Zeta\nstatus: paused\nlevel: 2\n---\n\n# Zeta\n");
    await write(
      "linear-algebra/PLAN.md",
      "---\ntitle: Linear algebra for ML\nstatus: active\nlevel: 1\ndeadline: 2026-12-15\nnext_action: Read chapter 3\n---\n\n# Plan\n",
    );

    const sets = await listSets(root);
    expect(sets.map((s) => s.slug)).toEqual(["linear-algebra", "zeta"]);
    expect(sets[0]).toEqual({
      slug: "linear-algebra",
      title: "Linear algebra for ML",
      status: "active",
      level: 1,
      deadline: "2026-12-15",
      nextAction: "Read chapter 3",
    });
    expect(sets[1]).toEqual({
      slug: "zeta",
      title: "Zeta",
      status: "paused",
      level: 2,
      deadline: null,
      nextAction: null,
    });
  });

  it("still lists a set whose PLAN.md has broken frontmatter", async () => {
    await write("linear-algebra/PLAN.md", "---\ntitle: [unclosed\n---\n\n# Plan\n");

    const sets = await listSets(root);
    expect(sets).toEqual([
      {
        slug: "linear-algebra",
        title: "linear-algebra",
        status: "draft",
        level: null,
        deadline: null,
        nextAction: null,
      },
    ]);
  });
});

describe("listNotes", () => {
  it("orders by frontmatter order, nulls last, then filename", async () => {
    await write("linear-algebra/notes/01-a.md", "---\ntitle: Alpha\norder: 2\nstatus: accepted\n---\n\nA\n");
    await write("linear-algebra/notes/02-b.md", "---\ntitle: Beta\norder: 1\n---\n\nB\n");
    await write("linear-algebra/notes/03-c.md", "# No frontmatter\n");
    await write("linear-algebra/notes/ignore.txt", "not a note\n");

    const notes = await listNotes(root, "linear-algebra");
    expect(notes.map((n) => n.path)).toEqual(["notes/02-b.md", "notes/01-a.md", "notes/03-c.md"]);
    expect(notes[0]).toEqual({ path: "notes/02-b.md", title: "Beta", order: 1, status: null });
    expect(notes[1]).toEqual({ path: "notes/01-a.md", title: "Alpha", order: 2, status: "accepted" });
    expect(notes[2]).toEqual({ path: "notes/03-c.md", title: "03-c", order: null, status: null });
  });

  it("falls back to the filename when a note has broken frontmatter", async () => {
    await write("linear-algebra/notes/04-bad.md", "---\ntitle: [unclosed\n---\n\nD\n");

    const notes = await listNotes(root, "linear-algebra");
    expect(notes).toEqual([{ path: "notes/04-bad.md", title: "04-bad", order: null, status: null }]);
  });
});

describe("readSetFile", () => {
  it("returns frontmatter and body for an existing file", async () => {
    await write("linear-algebra/notes/01-a.md", "---\ntitle: Alpha\norder: 1\n---\n\n# Alpha\n");

    const view = await readSetFile(root, "linear-algebra", "notes/01-a.md");
    expect(view).toEqual({ path: "notes/01-a.md", frontmatter: { title: "Alpha", order: 1 }, body: "\n# Alpha\n" });
  });

  it("returns null for a missing file", async () => {
    expect(await readSetFile(root, "linear-algebra", "notes/missing.md")).toBeNull();
  });
});

describe("isSetSlug", () => {
  it("accepts kebab-case slugs and rejects reserved or malformed names", () => {
    expect(isSetSlug("linear-algebra")).toBe(true);
    expect(isSetSlug("library")).toBe(false);
    expect(isSetSlug("_global")).toBe(false);
    expect(isSetSlug("-bad")).toBe(false);
  });
});
