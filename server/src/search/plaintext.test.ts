import { describe, expect, it } from "vitest";
import { plaintext } from "./plaintext.js";

describe("plaintext", () => {
  it("strips frontmatter and keeps the body text", () => {
    expect(plaintext("---\ntitle: SVD\nsources: [lib-strang-la]\n---\n\nThe body stays.\n")).toBe("The body stays.");
  });

  it("removes fenced code blocks including mermaid, both backtick and tilde", () => {
    const text = [
      "Before.",
      "```mermaid",
      "graph LR",
      '  U["U"] --> Ax["A x"]',
      "```",
      "Middle.",
      "~~~python",
      "print('hidden')",
      "~~~",
      "After.",
    ].join("\n");
    const result = plaintext(text);
    expect(result).toBe("Before. Middle. After.");
    for (const forbidden of ["graph LR", "-->", "```", "~~~", "print"]) {
      expect(result).not.toContain(forbidden);
    }
  });

  it("drops an unterminated fence to the end of the text", () => {
    expect(plaintext("Kept.\n```\ngone\nmore gone\n")).toBe("Kept.");
  });

  it("removes footnote definitions and references", () => {
    const text = [
      "The SVD matters.[^src:lib-strang-la#p364]",
      "",
      "[^src:lib-strang-la#p364]: Strang, *Introduction to Linear Algebra*, ch. 7.",
      "    A continuation line.",
      "",
      "A following paragraph.",
    ].join("\n");
    const result = plaintext(text);
    expect(result).toBe("The SVD matters. A following paragraph.");
    expect(result).not.toContain("[^");
    expect(result).not.toContain("#");
  });

  it("removes directive fences and title attributes but keeps their inner text", () => {
    const text = [":::definition", "Rank-k approximation.", ":::", ':::deeper{title="Eigenvectors"}', ":::"].join("\n");
    const result = plaintext(text);
    expect(result).toContain("Rank-k approximation.");
    expect(result).not.toContain(":::");
    expect(result).not.toContain("title=");
  });

  it("drops heading, list, emphasis, link and image syntax", () => {
    const text = [
      "# Heading",
      "## Nested heading",
      "- first item",
      "* second item",
      "1. numbered",
      "**bold** and *italic* and _underscored_",
      "[link text](https://example.com) and ![alt text](image.png)",
      "[reference][ref]",
      "",
      "[ref]: https://example.com",
    ].join("\n");
    const result = plaintext(text);
    expect(result).toBe(
      "Heading Nested heading first item second item numbered bold and italic and underscored link text and alt text reference",
    );
  });

  it("keeps maths as plain text and collapses runs of whitespace", () => {
    const text = "Every matrix   $A = U\\Sigma V^\\top$   factors.\n\n\n$$\nA = U \\Sigma V^\\top\n$$\n";
    const result = plaintext(text);
    expect(result).toBe("Every matrix $A = U\\Sigma V^\\top$ factors. $$ A = U \\Sigma V^\\top $$");
    expect(result).not.toMatch(/\s{2,}/);
  });

  it("drops HTML comments such as page markers", () => {
    expect(plaintext("Tokenizer <!-- p:4 --> compression")).toBe("Tokenizer compression");
  });
});

it("keeps shorter and info-bearing markers inside a longer code fence", () => {
  expect(plaintext("Public text\n\n````md\n```\nnot-indexable code\n````\nAfterward")).toBe("Public text Afterward");
  expect(plaintext("Public\n~~~~md\n~~~\nhidden\n~~~~info\nstill hidden\n~~~~~\nAfter")).toBe("Public After");
});
