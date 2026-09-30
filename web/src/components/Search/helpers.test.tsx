import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { searchHref, snippetParts } from "./helpers";
import { SearchSnippet } from "./SearchSnippet";

describe("search snippets", () => {
  it("escapes HTML both inside and outside matches", () => {
    const html = renderToStaticMarkup(
      <SearchSnippet snippet={'<img onerror="bad()"> [[<script>bad()</script>]] & tail'} />,
    );
    expect(html).toContain("&lt;img");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("<mark");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&amp; tail");
  });
  it("preserves unmatched delimiters and multiple matches", () => {
    expect(snippetParts("[[one]] and [[two]] [[unfinished")).toEqual([
      { text: "one", match: true },
      { text: " and ", match: false },
      { text: "two", match: true },
      { text: " [[unfinished", match: false },
    ]);
  });
  it("uses root-relative paths for navigation and ignores unsupported card anchors", () => {
    const base = { set: "algebra", title: "Title", snippet: "", score: 1 };
    expect(searchHref({ ...base, kind: "note", path: "algebra/notes/03-svd.md" }, "singular value")).toBe(
      "/s/algebra/n/03-svd.md?q=singular%20value",
    );
    expect(searchHref({ ...base, kind: "card", path: "algebra/cards/03-svd.md#c-abcd" }, "svd")).toBe(
      "/s/algebra/cards/03-svd.md",
    );
    expect(searchHref({ ...base, kind: "source", path: "library/lib-book/parsed/01.md" }, "svd")).toBe(
      "/library/lib-book",
    );
  });
});
