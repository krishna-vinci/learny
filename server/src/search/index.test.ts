import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openSearchIndex, type SearchIndex } from "./index.js";

const SAMPLE = fileURLToPath(new URL("../../../examples/sample-set", import.meta.url));
const NOTE = "linear-algebra/notes/03-svd.md";
const SOURCE = "library/lib-strang-la/source.md";
const CARDS = "linear-algebra/cards/03-svd.md";
let root: string;
let index: SearchIndex;
let outside: string | undefined;

async function write(rel: string, text: string): Promise<void> {
  const file = path.join(root, rel);
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text);
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-search-"));
  await fs.cp(SAMPLE, root, { recursive: true });
  await write(
    CARDS,
    `---\ndeck: SVD\nnote: notes/03-svd.md\n---\n
## c-1234abcd
<!-- status: draft · type: basic -->
**Q:** What is singular value decomposition?
**A:** Factor a matrix into rotations and stretching.

## c-5678abcd
<!-- status: approved · type: cloze -->
**Text:** The {{c1::singular values}} measure stretching.
**Extra:** Computing matrix spectra.
`,
  );
  index = openSearchIndex(root);
  await index.rebuildAll();
});

afterEach(async () => {
  await index.close();
  await fs.rm(root, { recursive: true, force: true });
  if (outside !== undefined) await fs.rm(outside, { recursive: true, force: true });
  outside = undefined;
});

describe("SearchIndex", () => {
  it("finds a phrase in a note, source and individual cards with marked snippets", () => {
    const results = index.query({ q: "singular value decomposition", limit: 50 });
    expect(results.map((result) => result.kind)).toEqual(expect.arrayContaining(["note", "source", "card"]));
    expect(results).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "note", path: NOTE, set: "linear-algebra" }),
        expect.objectContaining({ kind: "source", path: SOURCE, set: null }),
        expect.objectContaining({ kind: "card", path: `${CARDS}#c-1234abcd` }),
      ]),
    );
    expect(results.every((result) => result.snippet.includes("[[") && result.snippet.includes("]]"))).toBe(true);
    expect(index.query({ q: "stretching", kinds: ["card"], limit: 50 })).toHaveLength(2);
  });

  it("stems Porter-compatible pairs even when they are not the final prefix term", async () => {
    await write(NOTE, "# Stemming\nvector marker\ncomputed marker\nvalue marker\n");
    await index.upsertPath(NOTE);
    for (const q of ["vectors marker", "computing marker", "values marker"]) {
      expect(index.query({ q, kinds: ["note"], limit: 50 }).map((result) => result.path)).toContain(NOTE);
    }
  });

  it("prefix-matches the last word and treats explicit prefix syntax safely", () => {
    for (const q of ["decompos", "singular value decompos", "decompos*"]) {
      expect(index.query({ q, limit: 50 }).map((result) => result.path)).toContain(NOTE);
    }
  });

  it("filters sets and includes only sources linked to that set", async () => {
    await write("other/PLAN.md", "---\ntitle: Other\nsources: []\n---\n");
    await write("other/notes/01.md", "# Singular value decomposition\n");
    await index.rebuildAll();
    const results = index.query({ q: "decompos", set: "linear-algebra", limit: 50 });
    expect(results.some((result) => result.kind === "source" && result.set === null)).toBe(true);
    expect(results.every((result) => result.set === null || result.set === "linear-algebra")).toBe(true);
    expect(index.query({ q: "decompos", set: "other", limit: 50 }).map((result) => result.kind)).toEqual(["note"]);
    await write("other/PLAN.md", "---\ntitle: Other\nsources: [lib-strang-la]\n---\n");
    await index.upsertPath("other/PLAN.md");
    expect(index.query({ q: "decompos", set: "other", kinds: ["source"], limit: 50 })).toHaveLength(1);
    await fs.rm(path.join(root, "other/PLAN.md"));
    await index.removePath("other/PLAN.md");
    expect(index.query({ q: "decompos", set: "other", limit: 50 })).toEqual([]);
  });

  it("replaces changed notes and cards without stale or duplicate rows", async () => {
    await write(NOTE, "# Quaternions\nA quaternion note.\n");
    await index.upsertPath(NOTE);
    await index.upsertPath(NOTE);
    expect(index.query({ q: "quaternion", limit: 50 })).toHaveLength(1);
    expect(index.query({ q: "decompos", kinds: ["note"], limit: 50 })).toEqual([]);
    await write(
      CARDS,
      "## c-1234abcd\n<!-- status: draft · type: basic -->\n**Q:** What are quaternions?\n**A:** Rotations.\n",
    );
    await index.upsertPath(CARDS);
    expect(index.query({ q: "quaternion", kinds: ["card"], limit: 50 })).toHaveLength(1);
    expect(index.query({ q: "stretching", kinds: ["card"], limit: 50 })).toEqual([]);
  });

  it("aggregates parsed source text and updates or removes each contributing path", async () => {
    await write("library/lib-strang-la/parsed.md", "Quasars from the full text.\n");
    await write("library/lib-strang-la/parsed/01.md", "Neutrinos in a split part.\n");
    await index.rebuildAll();
    expect(index.query({ q: "quasars", limit: 50 })).toEqual([expect.objectContaining({ path: SOURCE })]);
    expect(index.query({ q: "neutrinos", limit: 50 })).toHaveLength(1);
    await write("library/lib-strang-la/parsed/01.md", "Leptons replace the split text.\n");
    await index.upsertPath("library/lib-strang-la/parsed/01.md");
    expect(index.query({ q: "neutrinos", limit: 50 })).toEqual([]);
    expect(index.query({ q: "leptons", limit: 50 })).toHaveLength(1);
    await fs.rm(path.join(root, "library/lib-strang-la/parsed.md"));
    await index.removePath("library/lib-strang-la/parsed.md");
    expect(index.query({ q: "quasars", limit: 50 })).toEqual([]);
    await fs.rm(path.join(root, SOURCE));
    await index.removePath(SOURCE);
    expect(index.query({ q: "leptons", limit: 50 })).toEqual([]);
  });

  it("removes deleted notes and all cards belonging to a deleted file", async () => {
    await fs.rm(path.join(root, NOTE));
    await index.removePath(NOTE);
    await fs.rm(path.join(root, CARDS));
    await index.removePath(CARDS);
    expect(index.query({ q: "decompos", limit: 50 }).map((result) => result.kind)).toEqual(["source"]);
  });

  it("does not throw for hostile syntax, empty terms or Unicode", () => {
    for (const q of ['"', "*", "NEAR(", ")", '"* NEAR(vector) OR title:matrix - )', "", "中文 café"]) {
      expect(() => index.query({ q, limit: 50 })).not.toThrow();
    }
    expect(index.query({ q: "*", limit: 50 })).toEqual([]);
    expect(index.query({ q: "vector OR missingword", limit: 50 })).toEqual([]);
  });

  it("weights titles above body-only matches", async () => {
    await write("linear-algebra/notes/title.md", "# Quasar\nGeneric text.\n");
    await write("linear-algebra/notes/body.md", "# Generic\nQuasar text.\n");
    await index.rebuildAll();
    const results = index.query({ q: "quasar", limit: 50 });
    expect(results.map((result) => result.path)).toEqual([
      "linear-algebra/notes/title.md",
      "linear-algebra/notes/body.md",
    ]);
    expect(results[0]?.score).toBeGreaterThan(results[1]?.score ?? 0);
  });

  it("serializes startup rebuilds and file updates, and rebuilds a reopened cache", async () => {
    const rebuild = index.rebuildAll();
    await write(NOTE, "# Quaternions\n");
    const update = index.upsertPath(NOTE);
    await Promise.all([rebuild, update]);
    expect(index.query({ q: "quaternion", limit: 50 })).toHaveLength(1);
    await index.close();
    index = openSearchIndex(root);
    expect(index.query({ q: "quaternion", limit: 50 })).toHaveLength(1);
    await fs.rm(path.join(root, NOTE));
    await index.rebuildAll();
    expect(index.query({ q: "quaternion", limit: 50 })).toEqual([]);
  });

  it("rejects escaping paths and never reads external symlink targets", async () => {
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "studium-search-outside-"));
    const secretFile = path.join(outside, "secret.md");
    await fs.writeFile(secretFile, "Confidentialquasar\n");
    await fs.symlink(secretFile, path.join(root, "linear-algebra/notes/secret.md"));
    await fs.symlink(outside, path.join(root, "library/lib-outside"));
    await fs.symlink(outside, path.join(root, "outside-set"));
    await fs.symlink(outside, path.join(root, "library/lib-strang-la/parsed"));
    expect(() => index.upsertPath("../secret.md")).toThrow();
    expect(() => index.upsertPath(secretFile)).toThrow();
    expect(() => index.upsertPath("linear-algebra/notes/secret.md")).toThrow();
    await index.rebuildAll();
    expect(index.query({ q: "confidentialquasar", limit: 50 })).toEqual([]);
    // A path swapped after indexing must not expose a cached hit through it.
    await fs.rm(path.join(root, NOTE));
    await fs.symlink(secretFile, path.join(root, NOTE));
    expect(index.query({ q: "decompos", kinds: ["note"], limit: 50 })).toEqual([]);
  });

  it("refuses symlinked cache directories and SQLite files", async () => {
    outside = await fs.mkdtemp(path.join(os.tmpdir(), "studium-search-cache-"));
    await index.close();
    await fs.rm(path.join(root, ".cache"), { recursive: true });
    await fs.symlink(outside, path.join(root, ".cache"));
    expect(() => openSearchIndex(root)).toThrow("symlink");
    await fs.rm(path.join(root, ".cache"));
    await fs.mkdir(path.join(root, ".cache"));
    await fs.symlink(path.join(outside, "search.db"), path.join(root, ".cache/search.db"));
    expect(() => openSearchIndex(root)).toThrow("symlink");
    expect(await fs.readdir(outside)).toEqual([]);
  });
});
