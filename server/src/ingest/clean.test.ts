import { describe, expect, it } from "vitest";
import { cleanMarkdown, pdfQuality } from "./clean.js";

describe("cleanMarkdown", () => {
  it("rejoins words hyphenated across line breaks", () => {
    expect(cleanMarkdown("This is an exam-\nple of a broken word.\n")).toContain("example");
  });

  it("keeps the existing hyphen when the next word is capitalized", () => {
    expect(cleanMarkdown("A well-\nKnown result.\n")).toContain("well-\nKnown");
  });

  it("drops lines that repeat on most pages", () => {
    const input = [
      "<!-- p:1 -->",
      "",
      "Handbook of Everything",
      "real first page content",
      "",
      "<!-- p:2 -->",
      "",
      "Handbook of Everything",
      "real second page content",
      "",
    ].join("\n");
    const cleaned = cleanMarkdown(input);
    expect(cleaned).not.toContain("Handbook of Everything");
    expect(cleaned).toContain("real first page content");
    expect(cleaned).toContain("<!-- p:1 -->");
    expect(cleaned).toContain("<!-- p:2 -->");
  });

  it("normalizes headings but leaves fenced code untouched", () => {
    const input = ["#Heading without a space", "###Title with trailing ###", "```", "#not a heading", "```"].join("\n");
    const cleaned = cleanMarkdown(input);
    expect(cleaned).toContain("# Heading without a space");
    expect(cleaned).toContain("### Title with trailing");
    expect(cleaned).toContain("#not a heading");
  });

  it("collapses runs of blank lines and trailing whitespace", () => {
    expect(cleanMarkdown("a   \n\n\n\nb\n")).toBe("a\n\nb\n");
  });
});

describe("pdfQuality", () => {
  it("accepts a dense, clean page", () => {
    expect(pdfQuality(["a".repeat(300)])).toEqual({ ok: true, reason: null });
  });

  it("rejects a sparse text layer", () => {
    const result = pdfQuality(["short page", "another short page"]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("low text density");
  });

  it("rejects a layer dominated by replacement characters", () => {
    const page = "\uFFFD".repeat(50) + "a".repeat(150);
    const result = pdfQuality([page]);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("replacement characters");
  });

  it("rejects an empty document", () => {
    expect(pdfQuality([]).ok).toBe(false);
  });
});
