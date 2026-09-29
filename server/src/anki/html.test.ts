import { describe, expect, it } from "vitest";
import { markdownToAnkiHtml } from "./html.js";

describe("markdownToAnkiHtml", () => {
  it("renders card Markdown and converts inline and display math for Anki", () => {
    const html = markdownToAnkiHtml(
      [
        "A **bold** and *small* answer with `$literal`.",
        "",
        "- inline $x^2$",
        "- `code $unchanged$`",
        "",
        "$$",
        "A = U\\Sigma V^\\top",
        "$$",
      ].join("\n"),
    );

    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<em>small</em>");
    expect(html).toContain("<ul><li>inline \\(x^2\\)</li><li><code>code $unchanged$</code></li></ul>");
    expect(html).toContain("\\[A = U\\Sigma V^\\top\\]");
  });

  it("escapes raw HTML while preserving cloze markers", () => {
    expect(markdownToAnkiHtml("{{c1::<script>alert(1)</script>}}")).toBe(
      "<p>{{c1::&lt;script&gt;alert(1)&lt;/script&gt;}}</p>",
    );
  });

  it("does not interpret a currency range as inline math", () => {
    expect(markdownToAnkiHtml("The price fell from $5-$10, while $x+y$ stayed symbolic.")).toBe(
      "<p>The price fell from $5-$10, while \\(x+y\\) stayed symbolic.</p>",
    );
  });
});
