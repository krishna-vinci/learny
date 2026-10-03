// Adapted from Memos (MIT) — https://github.com/usememos/memos
// Ported from MemoEditor/Editor/viewportDecorations.ts (recompute-on-viewport-change
// pattern), headingDecorations.ts and the markdown tag → class mapping in theme.ts (there
// built on `@lezer/highlight`'s `tagHighlighter`; `@lezer/highlight` isn't a direct `web/`
// dependency so this walks the Lezer syntax tree by node name instead — the same approach
// formatting.ts already uses for its commands), extended with Studium's frontmatter/math/
// citation/directive mark decorations. CSS classes only — no widgets — styled in theme.ts.
// Always on, regardless of the live-preview toggle (livePreview.ts); item 1 of the
// formatted-text-while-typing follow-up ("keeping item 1's styling" when the toggle hides
// items 2–4).
import { syntaxTree } from "@codemirror/language";
import type { Text } from "@codemirror/state";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { HEADING_LINE } from "./formatting";

const headingLineDecorations = [1, 2, 3, 4, 5, 6].map((level) => Decoration.line({ class: `cm-sm-h${level}` }));
const frontmatterDeco = Decoration.mark({ class: "cm-sm-frontmatter cm-sm-mono" });
const frontmatterLineDeco = Decoration.line({ class: "cm-sm-mono" });
const mathDeco = Decoration.mark({ class: "cm-sm-math cm-sm-mono" });
const citationDeco = Decoration.mark({ class: "cm-sm-citation" });
const directiveLineDeco = Decoration.line({ class: "cm-sm-directive" });
const monoLineDeco = Decoration.line({ class: "cm-sm-mono" });
const quoteLineDeco = Decoration.line({ class: "cm-sm-quote" });
const strongDeco = Decoration.mark({ class: "cm-sm-strong" });
const emphasisDeco = Decoration.mark({ class: "cm-sm-emphasis" });
const strikeDeco = Decoration.mark({ class: "cm-sm-strike" });
const inlineCodeDeco = Decoration.mark({ class: "cm-sm-inlinecode cm-sm-mono" });
const linkTextDeco = Decoration.mark({ class: "cm-sm-linktext" });
const urlDeco = Decoration.mark({ class: "cm-sm-url cm-sm-mono" });

// Math and citations share one alternation (display math tried before inline math, so a
// display span isn't matched as two adjacent inline spans) so a single matchAll pass yields
// every inline-mark match in ascending position order — RangeSetBuilder requires calls to
// `add` be non-decreasing in `from` across the whole range, not just within one category.
// `$$…$$` allows embedded newlines (`[\s\S]*?`, non-greedy): `displayMath` in formatting.ts
// always puts the opening/closing `$$` on their own lines around the content, so display
// math is normally multi-line; `$…$` and `[^src:…]` stay single-line.
const INLINE_MARK = /\$\$[\s\S]*?\$\$|\$[^$\n]+\$|\[\^src:[^\]\n]*\]/g;
/** A directive line: a bare `:::` fence or an inline `::visual{…}` / `::youtube{…}` / `::artifact{…}` tag. */
const DIRECTIVE_LINE = /^:{3}|^::(?:visual|youtube|artifact)\{/;

export interface InlineMarkMatch {
  from: number;
  to: number;
  kind: "math-display" | "math-inline" | "citation";
}

/** Every `$$…$$`, `$…$` or `[^src:…]` span within `[rangeFrom, rangeTo)` (document-relative
 * offsets), in ascending order. Shared by this file's always-on colouring and
 * livePreview.ts's cursor-aware widget/chip replacement, so the two can't disagree on
 * where a span is. Scoped to a range (typically one `view.visibleRanges` entry, not a
 * single line) so a multi-line `$$…$$` block is found as one span. */
export function findInlineMarks(view: EditorView, rangeFrom: number, rangeTo: number): InlineMarkMatch[] {
  const text = view.state.sliceDoc(rangeFrom, rangeTo);
  const matches: InlineMarkMatch[] = [];
  for (const m of text.matchAll(INLINE_MARK)) {
    const from = rangeFrom + (m.index ?? 0);
    const to = from + m[0].length;
    const kind = m[0].startsWith("[^src:") ? "citation" : m[0].startsWith("$$") ? "math-display" : "math-inline";
    matches.push({ from, to, kind });
  }
  return matches;
}

/** End offset of the leading frontmatter block (`---` … `---` at doc start), or null when
 * the document doesn't open with one. */
export function frontmatterEnd(doc: Text): number | null {
  if (doc.lines === 0 || doc.line(1).text.trim() !== "---") return null;
  for (let n = 2; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.text.trim() === "---") return line.to;
  }
  return null;
}

const MARK_NODE_DECO: Record<string, Decoration> = {
  StrongEmphasis: strongDeco,
  Emphasis: emphasisDeco,
  Strikethrough: strikeDeco,
  InlineCode: inlineCodeDeco,
  URL: urlDeco,
};

function build(view: EditorView): DecorationSet {
  // Collected then sorted before a single builder pass: this file makes two independent
  // passes per visible range (a per-line scan for frontmatter/heading/directive/math/
  // citation, and a tree walk for item 1's marks/links/code-blocks/quotes) whose hits
  // interleave in document order, and RangeSetBuilder requires `add` calls in non-decreasing
  // `from` order across the *whole* sequence, not just within one pass.
  const entries: { from: number; to: number; deco: Decoration }[] = [];
  const { doc } = view.state;
  const fmEnd = frontmatterEnd(doc);
  if (fmEnd !== null) entries.push({ from: 0, to: fmEnd, deco: frontmatterDeco });
  const tree = syntaxTree(view.state);
  const lineDeco = (line: { from: number }, deco: Decoration) => entries.push({ from: line.from, to: line.from, deco });

  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;
    for (let n = startLine; n <= endLine; n++) {
      const line = doc.line(n);
      if (fmEnd !== null && line.to <= fmEnd) {
        lineDeco(line, frontmatterLineDeco);
        continue;
      }
      const heading = HEADING_LINE.exec(line.text);
      const headingDeco = heading ? headingLineDecorations[(heading[1] ?? "").length - 1] : undefined;
      if (headingDeco) lineDeco(line, headingDeco);
      if (DIRECTIVE_LINE.test(line.text)) lineDeco(line, directiveLineDeco);
    }
    for (const m of findInlineMarks(view, from, to)) {
      entries.push({ from: m.from, to: m.to, deco: m.kind === "citation" ? citationDeco : mathDeco });
    }

    // One tree walk per visible range for the markdown markup highlighter (item 1): marks,
    // link text, fenced code blocks (kept mono) and blockquote lines (muted + italic).
    tree.iterate({
      from,
      to,
      enter: (node) => {
        const deco = MARK_NODE_DECO[node.name];
        if (deco) {
          entries.push({ from: node.from, to: node.to, deco });
          return;
        }
        if (node.name === "Link") {
          // The label is everything between the opening `[` and the matching `]`
          // (verified against the Lezer markdown parser: Link's LinkMark children are
          // `[`, `]`, `(`, `)` in that order).
          const marks: { from: number; to: number }[] = [];
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === "LinkMark") marks.push({ from: child.from, to: child.to });
          }
          const open = marks[0];
          const close = marks[1];
          if (open && close && open.to < close.from)
            entries.push({ from: open.to, to: close.from, deco: linkTextDeco });
          return;
        }
        if (node.name === "FencedCode" || node.name === "CodeBlock") {
          const startLn = doc.lineAt(node.from).number;
          const endLn = doc.lineAt(node.to).number;
          for (let ln = startLn; ln <= endLn; ln++) lineDeco(doc.line(ln), monoLineDeco);
          return;
        }
        if (node.name === "Blockquote") {
          const startLn = doc.lineAt(node.from).number;
          const endLn = doc.lineAt(node.to).number;
          for (let ln = startLn; ln <= endLn; ln++) lineDeco(doc.line(ln), quoteLineDeco);
        }
      },
    });
  }
  entries.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const entry of entries) builder.add(entry.from, entry.to, entry.deco);
  return builder.finish();
}

/** A ViewPlugin that maintains the note syntax decorations, rebuilding only when the
 * document or viewport changes (not on every selection-only update). */
export const noteSyntaxDecorations = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.viewportChanged) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);
