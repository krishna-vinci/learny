import { describe, expect, it } from "vitest";
import { PARSED_MAX_BYTES, splitParsed } from "./split.js";

const DENSE = "The quick brown fox jumps over the lazy dog and keeps on running. ";

describe("splitParsed", () => {
  it("keeps a small parse in a single parsed.md", () => {
    const result = splitParsed("# Notes\n\nSome content.\n");
    expect(result.parts).toEqual([{ path: "parsed.md", content: "# Notes\n\nSome content.\n" }]);
    expect(result.toc).toBeNull();
  });

  it("splits a large parse by top-level heading", () => {
    const body = DENSE.repeat(300); // ~20 KB per section
    const markdown = `# Vectors\n\n${body}\n\n# Matrices\n\n${body}\n\n# Eigenvalues\n\n${body}\n`;
    expect(Buffer.byteLength(markdown)).toBeGreaterThan(PARSED_MAX_BYTES);

    const result = splitParsed(markdown);
    expect(result.parts.map((part) => part.path)).toEqual([
      "parsed/01-vectors.md",
      "parsed/02-matrices.md",
      "parsed/03-eigenvalues.md",
    ]);
    expect(result.parts[0]?.content).toContain("# Vectors");
    expect(result.toc).toContain("| Section | Location |");
    expect(result.toc).toContain("| 2. Matrices | parsed/02-matrices.md |");
  });

  it("falls back to paragraph chunks when there are no top-level headings", () => {
    const paragraph = DENSE.repeat(10); // ~670 bytes
    const markdown = Array.from({ length: 100 }, (_value, index) => `${paragraph} ${index}`).join("\n\n");
    expect(Buffer.byteLength(markdown)).toBeGreaterThan(PARSED_MAX_BYTES);

    const result = splitParsed(markdown);
    expect(result.parts.length).toBeGreaterThan(1);
    expect(result.parts.every((part) => part.path.startsWith("parsed/") && part.path.endsWith(".md"))).toBe(true);
    expect(result.parts.every((part) => Buffer.byteLength(part.content) <= PARSED_MAX_BYTES)).toBe(true);
    expect(result.toc).toContain("| 1. Part 1 | parsed/01-part.md |");

    // Every paragraph survives the split exactly once.
    const rejoined = result.parts.map((part) => part.content.trimEnd()).join("\n\n");
    for (let index = 0; index < 100; index++) {
      expect(rejoined).toContain(`${paragraph} ${index}`);
    }
  });

  it("falls back to chunks when a single heading section is too large to keep", () => {
    const markdown = `# Huge\n\n${DENSE.repeat(5000)}\n`;
    expect(Buffer.byteLength(markdown)).toBeGreaterThan(PARSED_MAX_BYTES);

    const result = splitParsed(markdown);
    expect(result.parts.length).toBeGreaterThan(1);
    expect(result.parts[0]?.content).toContain("Huge");
  });
});
