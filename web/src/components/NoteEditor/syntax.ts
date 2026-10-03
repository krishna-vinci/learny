// Adapted from Memos (MIT) — https://github.com/usememos/memos
// Ported from MemoEditor/Editor/viewportDecorations.ts (recompute-on-viewport-change
// pattern) and headingDecorations.ts, extended with Studium's frontmatter/math/citation/
// directive mark decorations. CSS classes only — no widgets — styled in theme.ts.
import type { Text } from "@codemirror/state";
import { RangeSetBuilder } from "@codemirror/state";
import { Decoration, type DecorationSet, type EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { HEADING_LINE } from "./formatting";

const headingLineDecorations = [1, 2, 3, 4, 5, 6].map((level) => Decoration.line({ class: `cm-sm-h${level}` }));
const frontmatterDeco = Decoration.mark({ class: "cm-sm-frontmatter" });
const mathDeco = Decoration.mark({ class: "cm-sm-math" });
const citationDeco = Decoration.mark({ class: "cm-sm-citation" });
const directiveLineDeco = Decoration.line({ class: "cm-sm-directive" });

// Math and citations share one alternation (display math tried before inline math, so a
// display span isn't matched as two adjacent inline spans) so a single matchAll pass yields
// every inline-mark match in ascending position order — RangeSetBuilder requires calls to
// `add` be non-decreasing in `from` across the whole line, not just within one category.
const INLINE_MARK = /\$\$[^$\n]*\$\$|\$[^$\n]+\$|\[\^src:[^\]\n]*\]/g;
/** A directive line: a bare `:::` fence or an inline `::visual{…}` / `::youtube{…}` / `::artifact{…}` tag. */
const DIRECTIVE_LINE = /^:{3}|^::(?:visual|youtube|artifact)\{/;

/** End offset of the leading frontmatter block (`---` … `---` at doc start), or null when
 * the document doesn't open with one. */
function frontmatterEnd(doc: Text): number | null {
  if (doc.lines === 0 || doc.line(1).text.trim() !== "---") return null;
  for (let n = 2; n <= doc.lines; n++) {
    const line = doc.line(n);
    if (line.text.trim() === "---") return line.to;
  }
  return null;
}

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { doc } = view.state;
  const fmEnd = frontmatterEnd(doc);
  if (fmEnd !== null) builder.add(0, fmEnd, frontmatterDeco);

  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;
    for (let n = startLine; n <= endLine; n++) {
      const line = doc.line(n);
      if (fmEnd !== null && line.to <= fmEnd) continue; // already covered by the frontmatter mark
      const heading = HEADING_LINE.exec(line.text);
      const headingDeco = heading ? headingLineDecorations[(heading[1] ?? "").length - 1] : undefined;
      if (headingDeco) builder.add(line.from, line.from, headingDeco);
      if (DIRECTIVE_LINE.test(line.text)) builder.add(line.from, line.from, directiveLineDeco);
      for (const m of line.text.matchAll(INLINE_MARK)) {
        const start = line.from + (m.index ?? 0);
        builder.add(start, start + m[0].length, m[0].startsWith("[^src:") ? citationDeco : mathDeco);
      }
    }
  }
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
