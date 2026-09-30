import type { Highlight } from "@studium/shared";
import { describe, expect, it } from "vitest";
import { clearHighlights, placeHighlights } from "./highlight-dom";
import { locateQuote } from "./highlight-text";

describe("highlight text location", () => {
  it("disambiguates repeated quotes using their surrounding text", () => {
    const text = "First: same passage. Second: same passage!";
    expect(locateQuote(text, "same passage", "Second: ", "!")).toEqual({ start: 29, end: 41 });
    expect(locateQuote(text, "same passage")).toBeNull();
    expect(locateQuote(text, "missing")).toBeNull();
  });
  it("maps changed whitespace back to exact original offsets", () => {
    const text = "Before one\n  two after";
    const location = locateQuote(text, "one two", "Before ", " after");
    expect(location).toEqual({ start: 7, end: 16 });
    expect(text.slice(location?.start, location?.end)).toBe("one\n  two");
  });
  it("places across inline prose but preserves math, code and overlapping highlights", () => {
    const root = document.createElement("div");
    root.innerHTML =
      '<p>A <strong>small passage</strong> here.</p><p>Math <span class="katex">x squared</span></p><pre><code>code text</code></pre><p>After code.</p>';
    const original = root.innerHTML;
    const highlight = (id: string, quote: string): Highlight => ({
      id,
      quote,
      prefix: "",
      suffix: "",
      color: "yellow",
      createdAt: "2026-09-30",
    });
    const unplaced = placeHighlights(root, [
      highlight("h-a", "A small passage"),
      highlight("h-b", "small passage"),
      highlight("h-c", "x squared"),
      highlight("h-d", "code text"),
      highlight("h-e", "squaredcode"),
    ]);
    expect(unplaced).toEqual(["h-c", "h-d", "h-e"]);
    expect(root.querySelectorAll('[data-highlight-id="h-a"]')).toHaveLength(2);
    expect(root.querySelector('[data-highlight-id="h-b"]')?.textContent).toBe("small passage");
    expect(root.querySelector(".katex mark, pre mark")).toBeNull();
    clearHighlights(root);
    expect(root.innerHTML).toBe(original);
    expect(placeHighlights(root, [highlight("h-a", "A small passage")])).toEqual([]);
  });
});
