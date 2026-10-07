import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parsedFigureLinks, processMineruMarkdown } from "./mineru-markdown.js";

const source = { url: "https://arxiv.org/abs/2601.07372", title: "Conditional memory", authors: ["Cheng"] };
function png(width = 200, height = 150) {
  const bytes = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.write("IHDR", 12);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}
const uri = (bytes: Buffer) => `data:image/png;base64,${bytes.toString("base64")}`;

describe("MinerU markdown", () => {
  it("stages unmodified base64 figures, adjacent captions and source provenance in M14/M15 shape", () => {
    const bytes = png();
    const result = processMineruMarkdown(`## Retrieval\n\n![](${uri(bytes)})\n\nFigure 1: Lookup architecture.`, {
      ...source,
      license: "CC BY 4.0",
    });
    expect(result.embeddedFigures.figures).toHaveLength(1);
    const figure = result.embeddedFigures.figures[0];
    expect(figure).toMatchObject({
      path: expect.stringMatching(/^figures\/[a-f0-9]{24}\.png$/),
      width: 200,
      height: 150,
      caption: "Figure 1: Lookup architecture.",
      section: "Retrieval",
      license: "CC BY 4.0",
      sourcePage: source.url,
      creator: "Cheng",
    });
    expect(result.embeddedFigures.files.get(figure?.path ?? "")).toEqual(bytes);
    expect(result.markdown).not.toContain("base64");
    expect(result.markdown).toContain(`](${figure?.path})`);
    expect(parsedFigureLinks(result.markdown, "parsed/01-retrieval.md")).toContain("](../figures/");
    expect(parsedFigureLinks(result.markdown, "parsed.md")).toBe(result.markdown);
  });
  it("handles HTML embedded images, unknown licences, and skips tiny or invalid images", () => {
    const result = processMineruMarkdown(
      `Figure 2: Memory.\n\n<img src="${uri(png())}" alt="Memory">\n\n![](${uri(png(20, 20))})\n![](data:image/png;base64,AAAA)`,
      source,
    );
    expect(result.embeddedFigures.figures).toHaveLength(1);
    expect(result.embeddedFigures.figures[0]?.credit).toContain("licence unknown");
    expect(result.embeddedFigures.figures[0]?.sourcePage).toBe(source.url);
    expect(result.embeddedFigures.figures[0]?.caption).toBe("Figure 2: Memory.");
    expect(result.markdown).not.toContain("base64");
  });
  it("converts simple tables to GFM preserving math and escapes pipes; keeps spans", () => {
    const table =
      "<table><tr><th>Term</th><th>Value</th></tr><tr><td>$x \\mid y$</td><td>1|2<br>3 &amp; 4</td></tr></table>";
    const spanning = '<table><tr><td colspan="2">Wide</td></tr></table>';
    const result = processMineruMarkdown(`${table}\n\n${spanning}`, source);
    expect(result.markdown).toContain("| Term | Value |\n| --- | --- |\n| $x \\mid y$ | 1\\|2<br>3 & 4 |");
    expect(result.markdown).toContain(spanning);
  });
  it("drops obvious OCR junk while keeping inline/display math, code, rules and meaningful prose", () => {
    const excerpt = readFileSync(new URL("./fixtures/mineru-excerpt.md", import.meta.url), "utf8");
    const extra = "\n$$\n+ - = \\sum_{i=1}^n x_i\n$$\n\n$x$\n\n---\n\n```text\n+% (@!% #&\n```\n\nx = y\n";
    const result = processMineruMarkdown(excerpt + extra, source).markdown;
    expect(result).not.toContain("+% ('!%");
    expect(result).toContain("\\sum_{i=1}^n");
    expect(result).toContain("$x$");
    expect(result).toContain("+% (@!% #&");
    expect(result).toContain("x = y");
    for (const math of excerpt.match(/\$\$[\s\S]*?\$\$/g) ?? []) expect(result).toContain(math);
  });
});
