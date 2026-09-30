import type { Highlight } from "@studium/shared";
import { locateQuote } from "./highlight-text";

export const PROTECTED_TEXT = ".katex, math, pre, code, svg, .mermaid, [data-mermaid], button";
interface TextPiece {
  node: Text;
  start: number;
  end: number;
  protected: boolean;
}
export function articleText(root: HTMLElement) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const pieces: TextPiece[] = [];
  let text = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const protectedText = !!node.parentElement?.closest(PROTECTED_TEXT);
    const value = node.textContent ?? "";
    pieces.push({ node: node as Text, start: text.length, end: text.length + value.length, protected: protectedText });
    text += value;
  }
  return { text, pieces };
}
export function clearHighlights(root: HTMLElement) {
  for (const mark of root.querySelectorAll("mark[data-highlight-id]")) mark.replaceWith(...mark.childNodes);
  root.normalize();
}
export function placeHighlights(root: HTMLElement, highlights: Highlight[]): string[] {
  clearHighlights(root);
  const unplaced: string[] = [];
  for (const highlight of highlights) {
    const { text, pieces } = articleText(root);
    const match = locateQuote(text, highlight.quote, highlight.prefix, highlight.suffix);
    const touched = match ? pieces.filter((piece) => piece.end > match.start && piece.start < match.end) : [];
    if (!match || touched.length === 0 || touched.some((piece) => piece.protected)) {
      unplaced.push(highlight.id);
      continue;
    }
    for (const piece of touched) {
      const range = document.createRange();
      range.setStart(piece.node, Math.max(0, match.start - piece.start));
      range.setEnd(piece.node, Math.min(piece.node.length, match.end - piece.start));
      const mark = document.createElement("mark");
      mark.dataset.highlightId = highlight.id;
      mark.className = `reader-highlight highlight-${highlight.color}`;
      mark.tabIndex = 0;
      mark.setAttribute("role", "button");
      mark.setAttribute("aria-label", `Edit ${highlight.color} highlight`);
      range.surroundContents(mark);
    }
  }
  return unplaced;
}
export interface PassageSelection {
  quote: string;
  prefix: string;
  suffix: string;
  canHighlight: boolean;
  rect: DOMRect;
}
export function capturePassage(root: HTMLElement): PassageSelection | null {
  const selection = window.getSelection();
  if (!selection || selection.isCollapsed || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  const quote = range.toString();
  if (!quote.trim()) return null;
  const { text, pieces } = articleText(root);
  const before = document.createRange();
  before.selectNodeContents(root);
  before.setEnd(range.startContainer, range.startOffset);
  const start = before.toString().length;
  const end = start + quote.length;
  const unsafe =
    pieces.some((piece) => piece.protected && piece.end > start && piece.start < end) ||
    [...root.querySelectorAll(PROTECTED_TEXT)].some((element) => range.intersectsNode(element));
  return {
    quote,
    prefix: text.slice(Math.max(0, start - 64), start),
    suffix: text.slice(end, end + 64),
    canHighlight: !unsafe && quote.length <= 2000,
    rect: range.getBoundingClientRect(),
  };
}
