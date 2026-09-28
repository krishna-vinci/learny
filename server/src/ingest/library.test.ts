import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFrontmatter, SourceFrontmatter } from "@studium/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ensureRepo, log } from "../tree/git.js";
import { initStudyTree } from "../tree/init.js";
import { sha256Hex } from "./ids.js";
import { findDuplicate, listSources, readParsedFile, readSource, writeSource } from "./library.js";
import type { Extracted } from "./types.js";

const DENSE = "The quick brown fox jumps over the lazy dog and keeps on running. ";

function makeExtracted(overrides: Partial<Extracted> = {}): Extracted {
  return {
    title: "Introduction to Linear Algebra",
    authors: ["Gilbert Strang"],
    markdown: "# Vectors\n\nA short note about vectors.\n",
    pages: null,
    parseTier: "basic",
    warning: null,
    url: "https://math.example.com/linear-algebra",
    originalExt: "pdf",
    ...overrides,
  };
}

function bytesOf(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-library-"));
  await initStudyTree(root);
  await ensureRepo(root);
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("writeSource", () => {
  it("writes source.md, parsed.md and original, then commits the librarian paths", async () => {
    const bytes = bytesOf("%PDF-1.4 fake body");
    const { id, deduped } = await writeSource(root, makeExtracted(), { bytes, ext: "pdf" });

    expect(deduped).toBe(false);
    expect(id).toBe("lib-strang-introduction-to-linear-algebra");

    const sourceText = await fs.readFile(path.join(root, "library", id, "source.md"), "utf8");
    const { frontmatter, body } = parseFrontmatter(sourceText);
    const parsed = SourceFrontmatter.safeParse(frontmatter);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data.id).toBe(id);
      expect(parsed.data.type).toBe("paper");
      expect(parsed.data.credibility).toBe("pending");
      expect(parsed.data.parse_tier).toBe("basic");
      expect(parsed.data.sha256).toBe(sha256Hex(bytes));
    }
    expect(body).toContain("Summary pending.");

    await expect(fs.readFile(path.join(root, "library", id, "parsed.md"), "utf8")).resolves.toContain(
      "A short note about vectors",
    );
    await expect(fs.access(path.join(root, "library", id, "original.pdf"))).resolves.toBeUndefined();

    const history = await log(root, { limit: 1 });
    expect(history[0]?.subject).toBe(`librarian: ingest ${id}`);
    // TODO(T5 merge): the native author becomes "librarian".
    expect(["system", "librarian"]).toContain(history[0]?.author);
  });

  it("dedupes identical bytes by sha256", async () => {
    const bytes = bytesOf("identical file contents");
    const first = await writeSource(root, makeExtracted({ title: "First", url: "https://a.example/1" }), {
      bytes,
      ext: "pdf",
    });
    const second = await writeSource(root, makeExtracted({ title: "Second", url: "https://b.example/2" }), {
      bytes,
      ext: "pdf",
    });

    expect(second).toEqual({ id: first.id, deduped: true });
    const dirs = (await fs.readdir(path.join(root, "library"))).filter((name) => !name.startsWith("_"));
    expect(dirs).toEqual([first.id]);
  });

  it("dedupes by normalized URL across tracking params and fragments", async () => {
    const first = await writeSource(
      root,
      makeExtracted({ title: "Guide", url: "https://Example.com/guide/?utm_source=news#intro" }),
    );
    const second = await writeSource(
      root,
      makeExtracted({ title: "Duplicate title", url: "https://example.com/guide/" }),
    );

    expect(second).toEqual({ id: first.id, deduped: true });
  });

  it("suffixes a colliding id with -2 for different content", async () => {
    const first = await writeSource(root, makeExtracted({ markdown: "A\n", url: null, originalExt: null }));
    const second = await writeSource(root, makeExtracted({ markdown: "B\n", url: null, originalExt: null }));

    expect(first.id).toBe("lib-strang-introduction-to-linear-algebra");
    expect(second.id).toBe(`${first.id}-2`);
  });

  it("splits large sources into parsed/ parts with a TOC in source.md", async () => {
    const body = DENSE.repeat(300);
    const markdown = `# One\n\n${body}\n\n# Two\n\n${body}\n\n# Three\n\n${body}\n`;
    const { id } = await writeSource(
      root,
      makeExtracted({ title: "Big Book", authors: [], url: null, originalExt: "epub", markdown }),
    );

    expect(id).toBe("lib-big-book");
    const parts = await fs.readdir(path.join(root, "library", id, "parsed"));
    expect(parts).toEqual(["01-one.md", "02-two.md", "03-three.md"]);

    const sourceText = await fs.readFile(path.join(root, "library", id, "source.md"), "utf8");
    expect(sourceText).toContain("| Section | Location |");
    expect(sourceText).toContain("parsed/01-one.md");
  });

  it("records a parse warning in the frontmatter", async () => {
    const { id } = await writeSource(root, makeExtracted({ warning: "poor PDF text layer (low text density)" }));
    const sourceText = await fs.readFile(path.join(root, "library", id, "source.md"), "utf8");
    expect(parseFrontmatter(sourceText).frontmatter.parse_warning).toBe("poor PDF text layer (low text density)");
  });
});

describe("findDuplicate", () => {
  it("matches stored sources by arXiv id and DOI", async () => {
    const arxiv = await writeSource(
      root,
      makeExtracted({
        title: "Attention Is All You Need",
        authors: ["Ashish Vaswani"],
        url: "https://arxiv.org/abs/1706.03762",
      }),
    );
    const doi = await writeSource(
      root,
      makeExtracted({ title: "A Paper", authors: ["Jane Doe"], url: "https://doi.org/10.1000/182" }),
    );

    expect(await findDuplicate(root, { arxivId: "1706.03762" })).toBe(arxiv.id);
    expect(await findDuplicate(root, { doi: "10.1000/182" })).toBe(doi.id);
    expect(await findDuplicate(root, { arxivId: "9999.99999" })).toBeNull();
  });
});

describe("listSources and readSource", () => {
  it("returns summaries with linked sets, and a source view with parsed files", async () => {
    const { id } = await writeSource(root, makeExtracted({ warning: "poor PDF text layer" }));

    await fs.mkdir(path.join(root, "linear-algebra"), { recursive: true });
    await fs.writeFile(
      path.join(root, "linear-algebra", "PLAN.md"),
      `---\ntitle: Linear algebra\nstatus: active\nsources: [${id}]\n---\n\n## Goal\n`,
    );

    const sources = await listSources(root);
    expect(sources).toHaveLength(1);
    expect(sources[0]).toMatchObject({
      id,
      title: "Introduction to Linear Algebra",
      authors: ["Gilbert Strang"],
      type: "paper",
      credibility: "pending",
      parseTier: "basic",
      sets: ["linear-algebra"],
      warning: "poor PDF text layer",
    });

    const view = await readSource(root, id);
    expect(view?.parsedFiles).toEqual(["parsed.md"]);
    expect(view?.body).toContain("Summary pending.");
    expect(await readSource(root, "lib-missing")).toBeNull();
  });

  it("reads ordinary parsed files but rejects an in-root symlink outside the source parse", async () => {
    const { id } = await writeSource(root, makeExtracted());
    const parsed = path.join(root, "library", id, "parsed.md");

    await expect(readParsedFile(root, id, "parsed.md")).resolves.toContain("A short note about vectors");

    await fs.rm(parsed);
    await fs.symlink(path.join(root, "_global", "profile.md"), parsed);
    await expect(readParsedFile(root, id, "parsed.md")).resolves.toBeNull();
  });
});
