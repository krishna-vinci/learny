import { execFileSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FileLocks } from "../tree/lock.js";
import { assembleBook } from "./book-assemble.js";
import { createBookJob, redactBookError } from "./book-job.js";
import { bookPdfPath } from "./book-paths.js";
import { formatJobLogLine, parseJobLogLine } from "./log.js";
import type { JobContext } from "./runner.js";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-book-"));
  await fs.cp(fileURLToPath(new URL("../../../examples/sample-set/", import.meta.url)), root, { recursive: true });
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(root, { recursive: true, force: true });
});

function context(): JobContext {
  return { signal: new AbortController().signal, progress: vi.fn(), addUsage: vi.fn() };
}

function binariesPresent(): boolean {
  try {
    execFileSync("pandoc", ["--version"], { stdio: "ignore" });
    execFileSync("typst", ["--version"], { stdio: "ignore" });
    return true;
  } catch {
    console.warn(
      "Skipping real book compilation: pandoc and/or typst are missing from PATH (use PATH=$HOME/.local/bin:$PATH).",
    );
    return false;
  }
}
const hasBinaries = binariesPresent();

describe("compile-book", () => {
  it("assembles notes in order without frontmatter, with source footnotes and bibliography", async () => {
    const note = path.join(root, "linear-algebra/notes/01-vectors.md");
    await fs.writeFile(
      path.join(root, "linear-algebra/notes/99-first.md"),
      "---\ntitle: First by order\norder: 0\n---\n# First by order\n",
    );
    await fs.appendFile(
      note,
      "\nA citation [^src:lib-strang-la#p12].\n\n```mermaid\ngraph TD; A-->B\n```\n\n```md\n# Literal heading\n[^src:lib-unused#p1]\n```\n",
    );
    const source = path.join(root, "library/lib-strang-la/source.md");
    await fs.writeFile(
      source,
      (await fs.readFile(source, "utf8")).replace(
        "credibility: A",
        "credibility: A\npublisher: Wellesley-Cambridge Press",
      ),
    );
    const book = await assembleBook(root, "linear-algebra", new Date("2026-09-30T00:00:00Z"));
    expect(book.metadata).toMatchObject({ title: "Linear algebra for ML", date: "2026-09-30" });
    expect(book.metadata.goal).toContain("modern ML papers");
    expect(book.metadata.goal).toContain("hands-on NumPy practice.");
    expect(book.markdown.indexOf("# First by order")).toBeLessThan(
      book.markdown.indexOf("# Vectors and linear combinations"),
    );
    expect(book.markdown.indexOf("# Vectors and linear combinations")).toBeLessThan(
      book.markdown.indexOf("# Matrices"),
    );
    expect(book.markdown.indexOf("# Matrices")).toBeLessThan(book.markdown.indexOf("# Singular value decomposition"));
    expect(book.markdown).not.toMatch(/^(title|status|order|sources):/m);
    expect(book.markdown).toContain("::: {.deeper}");
    expect(book.markdown).toContain("*(diagram in the app)*");
    expect(book.markdown).not.toContain("graph TD");
    expect(book.markdown).toContain("# Literal heading\n[^src:lib-unused#p1]");
    expect(book.markdown).toContain("A citation [^book-src-1]");
    expect(book.markdown).toContain("[^book-src-1]: Introduction to Linear Algebra — p12.");
    expect(book.markdown).toContain("# Bibliography");
    expect(book.markdown).toContain(
      "Introduction to Linear Algebra — Gilbert Strang — Wellesley-Cambridge Press — Tier A",
    );
  });

  it("rejects traversal and cache/notes symlink escapes", async () => {
    await expect(assembleBook(root, "../outside")).rejects.toThrow("invalid set");
    await fs.symlink(os.tmpdir(), path.join(root, "linear-algebra/.cache"));
    await expect(bookPdfPath(root, "linear-algebra")).rejects.toThrow("symlinks");
    await fs.rm(path.join(root, "linear-algebra/notes"), { recursive: true });
    await fs.symlink(os.tmpdir(), path.join(root, "linear-algebra/notes"));
    await expect(assembleBook(root, "linear-algebra")).rejects.toThrow("escapes study root");
  });

  it("redacts compiler diagnostics and retains compile-book in job history", () => {
    vi.stubEnv("BOOK_TEST_TOKEN", "private-test-token");
    expect(
      redactBookError("/workspace/notes private-test-token https://user:pass@example.org/x?token=secret", [
        "/workspace",
      ]),
    ).toBe("[workspace]/notes [redacted] [url]");
    const line = formatJobLogLine({
      id: "book",
      kind: "compile-book",
      set: "linear-algebra",
      title: "Book",
      status: "done",
      progress: "",
      startedAt: null,
      finishedAt: "2026-09-30T00:00:00Z",
      billing: "metered",
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
    });
    expect(parseJobLogLine(line, "linear-algebra")?.kind).toBe("compile-book");
  });

  it.skipIf(!hasBinaries)(
    "builds a real PDF over 10 KB, with callouts, maths and safe chapter headings",
    async () => {
      await fs.appendFile(
        path.join(root, "linear-algebra/notes/01-vectors.md"),
        '\nA citation [^src:lib-strang-la#p12].\n\n:::definition\nA definition with $x^2$.\n:::\n\n:::theorem\nA theorem.\n:::\n\n:::example\nAn example.\n:::\n\n```typst\n#panic("code must stay literal")\n```\n\n```{=typst}\n#panic("raw code must not execute")\n```\n',
      );
      const ctx = context();
      const book = await assembleBook(root, "linear-algebra");
      const ast = JSON.parse(
        execFileSync(
          "pandoc",
          [
            "-f",
            "markdown+tex_math_dollars+fenced_divs-raw_attribute",
            "-t",
            "json",
            "--lua-filter",
            fileURLToPath(new URL("../../templates/book/callouts.lua", import.meta.url)),
          ],
          { input: book.markdown, encoding: "utf8" },
        ),
      ) as { blocks: Array<{ t: string; c: unknown[] }> };
      const levels = ast.blocks.filter((block) => block.t === "Header").map((block) => block.c[0]);
      expect(levels.filter((level) => level === 1)).toHaveLength(4);
      expect(levels).toContain(2);
      expect(levels).not.toContain(3);
      await createBookJob({ root, locks: new FileLocks() })({ set: "linear-algebra" }, ctx);
      const bytes = await fs.readFile(await bookPdfPath(root, "linear-algebra"));
      expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
      expect(bytes.length).toBeGreaterThan(10_000);
      expect(await fs.readdir(path.join(root, ".cache"))).toEqual([]);
      expect(ctx.addUsage).not.toHaveBeenCalled();
      expect(ctx.progress).toHaveBeenLastCalledWith("Book ready to download");
    },
    120_000,
  );

  it("cleans temporary files and preserves the last PDF when a compiler is missing", async () => {
    const pdf = await bookPdfPath(root, "linear-algebra");
    await fs.mkdir(path.dirname(pdf), { recursive: true });
    await fs.writeFile(pdf, "last successful book");
    vi.stubEnv("PATH", "");
    await expect(createBookJob({ root, locks: new FileLocks() })({ set: "linear-algebra" }, context())).rejects.toThrow(
      "pandoc failed: binary is missing from PATH",
    );
    expect(await fs.readdir(path.join(root, ".cache"))).toEqual([]);
    expect(await fs.readFile(pdf, "utf8")).toBe("last successful book");
  });

  it("captures and redacts stderr from a failed compiler", async () => {
    const bin = path.join(root, "test-bin");
    await fs.mkdir(bin);
    vi.stubEnv("BOOK_TEST_TOKEN", "private-test-token");
    await fs.writeFile(
      path.join(bin, "pandoc"),
      `#!${process.execPath}\nprocess.stderr.write(${JSON.stringify(`compiler diagnostic ${root}/notes private-test-token https://example.org/?token=secret`)}); process.exit(1);\n`,
      { mode: 0o700 },
    );
    vi.stubEnv("PATH", bin);
    await expect(createBookJob({ root, locks: new FileLocks() })({ set: "linear-algebra" }, context())).rejects.toThrow(
      "pandoc failed: compiler diagnostic [workspace]/notes [redacted] [url]",
    );
    expect(await fs.readdir(path.join(root, ".cache"))).toEqual([]);
  });

  it("keeps a callout's label attached to its first lines", async () => {
    const template = await fs.readFile(
      fileURLToPath(new URL("../../templates/book/book.typ", import.meta.url)),
      "utf8",
    );
    const callout = /#let book-callout[\s\S]*?\n\]\n/.exec(template)?.[0] ?? "";
    // A sticky label block cannot be left alone at the bottom of a page.
    expect(callout).toMatch(/block\(sticky: true[^)]*\)\[#text\(weight: "bold", size: 10pt\)\[#label\]\]/);
  });

  it.skipIf(!hasBinaries)("compiles a long chapter full of callouts that straddle page breaks", async () => {
    const filler = Array.from(
      { length: 40 },
      (_, index) =>
        `Paragraph ${index} ${"vector space ".repeat(30)}\n\n:::definition\nDefinition ${index} ${"rank ".repeat(25)}\n:::\n\n:::deeper\n${"kernel image ".repeat(30)}\n\n${"span basis ".repeat(30)}\n:::\n`,
    ).join("\n");
    await fs.appendFile(path.join(root, "linear-algebra/notes/02-matrices.md"), `\n${filler}\n`);
    await createBookJob({ root, locks: new FileLocks() })({ set: "linear-algebra" }, context());
    const pdf = await fs.readFile(await bookPdfPath(root, "linear-algebra"));
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(10_000);
  });
});

it("rejects excessive chapters and Markdown before launching a compiler", async () => {
  const notes = path.join(root, "linear-algebra/notes");
  for (let i = 0; i < 198; i++) await fs.writeFile(path.join(notes, `extra-${i}.md`), "# Extra");
  await expect(assembleBook(root, "linear-algebra")).rejects.toThrow("at most 200 chapters");
  for (let i = 0; i < 198; i++) await fs.unlink(path.join(notes, `extra-${i}.md`));
  await fs.writeFile(path.join(notes, "01-vectors.md"), "x".repeat(5_000_001));
  await expect(assembleBook(root, "linear-algebra")).rejects.toThrow("at most 5 MB");
});

it("checks cancellation between chapter input reads", async () => {
  const controller = new AbortController();
  const original = fs.stat;
  const stat = vi.spyOn(fs, "stat").mockImplementation(async (...args: Parameters<typeof fs.stat>) => {
    const result = await original(...args);
    if (String(args[0]).endsWith("01-vectors.md")) controller.abort();
    return result;
  });
  try {
    await expect(assembleBook(root, "linear-algebra", new Date(), controller.signal)).rejects.toThrow();
    expect(stat).toHaveBeenCalledTimes(1);
  } finally {
    stat.mockRestore();
  }
});

it("rejects oversized PDFs and preserves the previous book with scratch cleanup", async () => {
  const bin = path.join(root, "bin");
  await fs.mkdir(bin);
  await fs.writeFile(path.join(bin, "pandoc"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  await fs.writeFile(path.join(bin, "typst"), "#!/bin/sh\n/usr/bin/truncate -s 50000001 out.pdf\n", { mode: 0o755 });
  vi.stubEnv("PATH", bin);
  const output = await bookPdfPath(root, "linear-algebra");
  await fs.mkdir(path.dirname(output), { recursive: true });
  await fs.writeFile(output, "previous PDF");
  await expect(createBookJob({ root, locks: new FileLocks() })({ set: "linear-algebra" }, context())).rejects.toThrow(
    "at most 50 MB",
  );
  expect(await fs.readFile(output, "utf8")).toBe("previous PDF");
  expect((await fs.readdir(path.join(root, ".cache"))).filter((name) => name.startsWith("book-"))).toEqual([]);
});

it("copies confined SVG and PNG references before compiling, preserving remote captions", async () => {
  const { createBookMedia } = await import("./book-media.js");
  const temp = await fs.mkdtemp(path.join(root, "media-test-"));
  await fs.mkdir(path.join(root, "linear-algebra/assets"));
  const svg = '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="8" fill="#276"/></svg>';
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNwaDjwHwAFBAKAPJ4DgAAAAABJRU5ErkJggg==",
    "base64",
  );
  await fs.writeFile(path.join(root, "linear-algebra/assets/x.svg"), svg);
  await fs.writeFile(path.join(root, "linear-algebra/assets/x.png"), png);
  await fs.mkdir(path.join(root, "linear-algebra/artifacts"));
  await fs.writeFile(path.join(root, "linear-algebra/artifacts/visual.svg"), svg);
  await fs.appendFile(
    path.join(root, "linear-algebra/notes/01-vectors.md"),
    '\n![SVG](../assets/x.svg)\n\n![PNG](../assets/x.png)\n\n![Remote](https://example.org/image.png)\n\n![Reference][x]\n![Short]\n[x]: ../assets/x.svg\n[Short]: ../assets/x.png\n\n::artifact{src="../artifacts/not-read.html" poster="../artifacts/visual.svg" title="Explore vectors"}\n',
  );
  const book = await assembleBook(root, "linear-algebra", new Date(), undefined, createBookMedia(root, temp));
  expect(book.markdown).toContain("![SVG](media/image-1.svg)");
  expect(book.markdown).toContain("![PNG](media/image-2.png)");
  expect(book.markdown).toContain("![Reference](media/image-1.svg)");
  expect(book.markdown).toContain("![Short](media/image-2.png)");
  expect(book.markdown).toContain("https://example.org/image.png");
  expect(book.markdown).toContain("## Visuals in Studium");
  expect(book.markdown).toContain(
    "![Interactive: Explore vectors — open this chapter's Visuals tab in Studium](media/image-3.svg)",
  );
  expect(await fs.readFile(path.join(temp, "media/image-1.svg"), "utf8")).toBe(svg);
  expect(await fs.readFile(path.join(temp, "media/image-2.png"))).toEqual(png);
  if (hasBinaries) await createBookJob({ root, locks: new FileLocks() })({ set: "linear-algebra" }, context());
});

it("turns YouTube moments into a local thumbnail, time and link", async () => {
  const { createBookMedia } = await import("./book-media.js");
  const temp = await fs.mkdtemp(path.join(root, "video-test-"));
  await fs.mkdir(path.join(root, "library/lib-video"));
  await fs.writeFile(
    path.join(root, "library/lib-video/source.md"),
    "---\nid: lib-video\ntitle: Lecture\ntype: video\ncredibility: A\nparse_tier: transcript\nadded: 2026-10-01\nurl: https://youtu.be/dQw4w9WgXcQ\n---\n",
  );
  await fs.writeFile(path.join(root, "library/lib-video/thumb.jpg"), new Uint8Array([255, 216, 255]));
  const text = await createBookMedia(root, temp)(
    '::youtube{src="https://youtu.be/dQw4w9WgXcQ" start=843 end=900}',
    "linear-algebra/notes/x.md",
  );
  expect(text).toContain("Video: Lecture at 14:03");
  expect(text).toContain("media/image-1.jpg");
  expect(text).toContain("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=843s");
  expect(await fs.readFile(path.join(temp, "media/image-1.jpg"))).toEqual(Buffer.from([255, 216, 255]));
  const timed = await createBookMedia(root, temp)(
    '::youtube{src="https://music.youtube.com/watch?v=dQw4w9WgXcQ&t=14m3s"}',
    "linear-algebra/notes/x.md",
  );
  expect(timed).toContain("Video: Lecture at 14:03");
  expect(timed).toContain("media/image-1.jpg");
  expect(timed).toContain("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=843s");
});

it("replaces inline Vega-Lite fences with a local SVG and keeps invalid specs readable", async () => {
  const { createBookMedia } = await import("./book-media.js");
  const temp = await fs.mkdtemp(path.join(root, "chart-test-"));
  const prepare = createBookMedia(root, temp);
  const spec = JSON.stringify({
    data: { values: [{ x: 1, y: 2 }] },
    mark: "point",
    encoding: { x: { field: "x", type: "quantitative" }, y: { field: "y", type: "quantitative" } },
  });
  expect(await prepare(`\`\`\`vega-lite\n${spec}\n\`\`\``, "linear-algebra/notes/x.md")).toBe(
    "![Data chart](media/chart-1.svg)",
  );
  expect(await fs.readFile(path.join(temp, "media/chart-1.svg"), "utf8")).toContain("<svg");
  const bad = '```vega-lite\n{"data":{"url":"https://example.org/data.json"},"mark":"point"}\n```';
  expect(await prepare(bad, "linear-algebra/notes/x.md")).toBe(bad);
});

it("uses an artifact's poster and static caption without reading its HTML", async () => {
  const { createBookMedia } = await import("./book-media.js");
  const temp = await fs.mkdtemp(path.join(root, "artifact-test-"));
  await fs.mkdir(path.join(root, "linear-algebra/artifacts"));
  await fs.writeFile(
    path.join(root, "linear-algebra/artifacts/demo.svg"),
    '<svg viewBox="0 0 10 10"><circle r="2"/></svg>',
  );
  const prepare = createBookMedia(root, temp);
  const text = await prepare(
    '::artifact{src="../artifacts/demo.html" poster="../artifacts/demo.svg" title="Projection"}',
    "linear-algebra/notes/x.md",
  );
  expect(text).toContain(
    "## Visuals in Studium\n\n![Interactive: Projection — open this chapter's Visuals tab in Studium](media/image-1.svg)",
  );
  expect(
    await prepare('::artifact{src="../artifacts/demo.html" title="Projection"}', "linear-algebra/notes/x.md"),
  ).toContain("Interactive: Projection — open this chapter's Visuals tab in Studium");
});

it("passes rewritten Markdown and copied image bytes to the compiler process", async () => {
  await fs.mkdir(path.join(root, "linear-algebra/assets"));
  const svg = '<svg viewBox="0 0 10 10"><circle r="2"/></svg>';
  await fs.writeFile(path.join(root, "linear-algebra/assets/stub.svg"), svg);
  await fs.appendFile(path.join(root, "linear-algebra/notes/01-vectors.md"), "\n![Stub](../assets/stub.svg)\n");
  const run = vi.fn(async (binary: string, _args: string[], cwd: string) => {
    if (binary === "pandoc") {
      expect(await fs.readFile(path.join(cwd, "book.md"), "utf8")).toContain("![Stub](media/image-1.svg)");
      expect(await fs.readFile(path.join(cwd, "media/image-1.svg"), "utf8")).toBe(svg);
    } else await fs.writeFile(path.join(cwd, "out.pdf"), "%PDF-1.4 stub");
  });
  await createBookJob({ root, locks: new FileLocks(), run })({ set: "linear-algebra" }, context());
  expect(run.mock.calls.map(([binary]) => binary)).toEqual(["pandoc", "typst"]);
});

it("collects visual fallbacks after prose, deduplicates attachments and keeps fenced examples inert", async () => {
  const { createBookMedia } = await import("./book-media.js");
  const temp = await fs.mkdtemp(path.join(root, "visuals-test-"));
  const prepare = createBookMedia(root, temp);
  const visual = '::artifact{src="../artifacts/demo.html" poster="../artifacts/missing.svg" title="Explore"}';
  const code = `\`\`\`md\n${visual}\n\`\`\``;
  const text = await prepare(
    `Opening.\n${visual}\nClosing.\n${visual}\n${code}\n::artifact{src="../../beta/artifacts/x.html"}`,
    "linear-algebra/notes/x.md",
  );
  expect(text.indexOf("## Visuals in Studium")).toBeGreaterThan(text.indexOf("Closing."));
  expect(text).toContain(code);
  expect(text.match(/Interactive: Explore/g)).toHaveLength(1);
  expect(text).toContain("Interactive: Interactive figure (unavailable)");
  expect(text).not.toContain("media/image");
});
