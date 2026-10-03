// Obsidian-style live preview (items 2–4 of the formatted-text-while-typing follow-up):
// on lines/spans the cursor and selection don't touch, markup is hidden (`Decoration.
// replace`) or replaced with a rendered widget; the active line/span shows raw markdown
// (dimmed markup) so it's editable. Never changes the document — decorations only, so the
// saved byte-exact text is untouched. Toggled by the "Show markdown" button in Toolbar.tsx,
// which reconfigures this whole extension in or out of a Compartment (see
// CodeMirrorNoteEditor.tsx) rather than gating it internally, so switching it off also
// cleanly removes every widget/replace this file ever added.
import { syntaxTree } from "@codemirror/language";
import type { EditorState, Extension, Transaction } from "@codemirror/state";
import { RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView, ViewPlugin, type ViewUpdate, WidgetType } from "@codemirror/view";
import { formatMediaTime } from "@studium/shared/media";
import { HEADING_LINE } from "./formatting";
import { ensureKatexLoaded, katexReadyEffect, MathWidget } from "./mathWidget";
import { findInlineMarks, type InlineMarkMatch } from "./syntax";

const CALLOUT_LABELS: Record<string, string> = { definition: "Definition", theorem: "Theorem", example: "Example" };
function calloutLabel(name: string): string {
  return name === "deeper" ? "Deeper" : (CALLOUT_LABELS[name] ?? name);
}

const CALLOUT_OPEN = /^:::([a-zA-Z][\w-]*)(\{.*\})?\s*$/;
const DIRECTIVE_CLOSE = /^:::\s*$/;
const VISUAL_LINE = /^::visual\{(.*)\}\s*$/;
const YOUTUBE_LINE = /^::youtube\{(.*)\}\s*$/;

function parseAttrs(raw: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  const re = /([a-zA-Z_][\w-]*)=(?:"([^"]*)"|(\S+))/g;
  for (const m of raw.matchAll(re)) {
    const name = m[1];
    if (name) attrs[name] = m[2] ?? m[3] ?? "";
  }
  return attrs;
}

function touchesRange(state: EditorState, from: number, to: number): boolean {
  return state.selection.ranges.some((r) => r.from <= to && r.to >= from);
}

/** A non-editing chip: a small widget that shows a human label instead of raw directive
 * markup, and places the cursor at `sourceFrom` (opening the raw text for editing) on click. */
class ChipWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly className: string,
    readonly block: boolean,
    readonly sourceFrom: number,
  ) {
    super();
  }
  override eq(other: ChipWidget): boolean {
    return other.text === this.text && other.className === this.className && other.block === this.block;
  }
  toDOM(view: EditorView): HTMLElement {
    const el = document.createElement(this.block ? "div" : "span");
    el.className = this.className;
    el.textContent = this.text;
    el.addEventListener("mousedown", (event) => {
      event.preventDefault();
      view.dispatch({ selection: { anchor: this.sourceFrom } });
      view.focus();
    });
    return el;
  }
  override ignoreEvent(): boolean {
    return false;
  }
}

function visualChipText(body: string): string {
  const attrs = parseAttrs(body);
  if (attrs.title) return `Visual: ${attrs.title}`;
  const src = attrs.src ?? "";
  const file = src.split("/").pop() ?? src;
  return `Visual: ${file || "untitled"}`;
}

function youtubeChipText(body: string): string {
  const attrs = parseAttrs(body);
  const start = Number.parseInt(attrs.start ?? "0", 10);
  return `Video at ${formatMediaTime(Number.isFinite(start) ? start : 0)}`;
}

interface Entry {
  from: number;
  to: number;
  deco: Decoration;
}

/** Hide `[from, to)` (a markup token) when `active` is false; dim it in place otherwise. */
function markupEntry(active: boolean, from: number, to: number): Entry {
  return active
    ? { from, to, deco: Decoration.mark({ class: "cm-sm-markup-dim" }) }
    : { from, to, deco: Decoration.replace({}) };
}

function build(view: EditorView, citationTitles: Map<string, string>): DecorationSet {
  const { state } = view;
  const { doc } = state;
  const entries: Entry[] = [];
  const tree = syntaxTree(state);

  for (const { from, to } of view.visibleRanges) {
    const startLine = doc.lineAt(from).number;
    const endLine = doc.lineAt(to).number;

    for (let n = startLine; n <= endLine; n++) {
      const line = doc.line(n);
      const lineActive = touchesRange(state, line.from, line.to);

      // Heading marker (item 2): hide/dim the leading `#…` prefix.
      const heading = HEADING_LINE.exec(line.text);
      if (heading) entries.push(markupEntry(lineActive, line.from, line.from + heading[0].length));

      // Directive lines (item 4), line-granularity per the spec.
      if (!lineActive) {
        const visual = VISUAL_LINE.exec(line.text);
        const youtube = YOUTUBE_LINE.exec(line.text);
        const open = CALLOUT_OPEN.exec(line.text);
        if (visual) {
          entries.push({
            from: line.from,
            to: line.to,
            deco: Decoration.replace({
              widget: new ChipWidget(visualChipText(visual[1] ?? ""), "cm-sm-directive-chip", true, line.from),
            }),
          });
        } else if (youtube) {
          entries.push({
            from: line.from,
            to: line.to,
            deco: Decoration.replace({
              widget: new ChipWidget(youtubeChipText(youtube[1] ?? ""), "cm-sm-directive-chip", true, line.from),
            }),
          });
        } else if (open) {
          const name = open[1] ?? "";
          const attrs = parseAttrs(open[2] ?? "");
          const label = attrs.title ? `${calloutLabel(name)} · ${attrs.title}` : calloutLabel(name);
          entries.push({
            from: line.from,
            to: line.to,
            deco: Decoration.replace({ widget: new ChipWidget(label, "cm-sm-callout-open", true, line.from) }),
          });
        } else if (DIRECTIVE_CLOSE.test(line.text)) {
          entries.push({ from: line.from, to: line.to, deco: Decoration.mark({ class: "cm-sm-callout-close" }) });
        }
      }
    }

    // Math and citations (item 3 / item 4) are span-granular: the cursor has to be inside
    // the specific `$…$`/`[^src:…]` span, not just on its line. Scoped to the whole visible
    // range (not per line). Multi-line `$$…$$` blocks are skipped here — CodeMirror only
    // allows *block* decorations (which a multi-line replace must be) from a StateField, not
    // a ViewPlugin, so those are built separately by `multilineMathField` below.
    for (const m of findInlineMarks(view, from, to)) {
      if (m.kind === "math-display" && doc.lineAt(m.from).number !== doc.lineAt(m.to).number) continue;
      const active = touchesRange(state, m.from, m.to);
      if (active) continue; // raw source stays visible, already styled by syntax.ts
      const entry = mathOrCitationEntry(view, m, citationTitles);
      if (entry) entries.push(entry);
    }

    // One tree walk per visible range for hiding/dimming inline mark pairs (item 2).
    tree.iterate({
      from,
      to,
      enter: (node) => {
        if (node.name === "StrongEmphasis" || node.name === "Emphasis" || node.name === "Strikethrough") {
          const markName = node.name === "Strikethrough" ? "StrikethroughMark" : "EmphasisMark";
          const lineActive = touchesRange(state, doc.lineAt(node.from).from, doc.lineAt(node.to).to);
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === markName) entries.push(markupEntry(lineActive, child.from, child.to));
          }
          return;
        }
        if (node.name === "InlineCode") {
          const lineActive = touchesRange(state, doc.lineAt(node.from).from, doc.lineAt(node.to).to);
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === "CodeMark") entries.push(markupEntry(lineActive, child.from, child.to));
          }
          return;
        }
        if (node.name === "Link") {
          // `](url)`: LinkMark children are `[`, `]`, `(`, `)` in order; hide/dim from the
          // closing `]` through the closing `)`, leaving the opening `[` and the link text
          // (styled by syntax.ts's cm-sm-linktext) untouched.
          const marks: { from: number; to: number }[] = [];
          for (let child = node.node.firstChild; child; child = child.nextSibling) {
            if (child.name === "LinkMark") marks.push({ from: child.from, to: child.to });
          }
          const closeBracket = marks[1];
          const closeParen = marks[3];
          if (closeBracket && closeParen) {
            const lineActive = touchesRange(state, doc.lineAt(node.from).from, doc.lineAt(node.to).to);
            entries.push(markupEntry(lineActive, closeBracket.from, closeParen.to));
          }
        }
      },
    });
  }

  entries.sort((a, b) => a.from - b.from || a.to - b.to);
  const builder = new RangeSetBuilder<Decoration>();
  for (const entry of entries) builder.add(entry.from, entry.to, entry.deco);
  return builder.finish();
}

function mathOrCitationEntry(view: EditorView, m: InlineMarkMatch, citationTitles: Map<string, string>): Entry | null {
  if (m.kind === "citation") {
    const id = view.state.sliceDoc(m.from + 6, m.to - 1); // strip `[^src:` and `]`
    const label = citationTitles.get(id) ?? id;
    return {
      from: m.from,
      to: m.to,
      deco: Decoration.replace({ widget: new ChipWidget(label, "cm-sm-citation-chip", false, m.from) }),
    };
  }
  // Single-line only (inline `$…$` or a one-line `$$…$$`) — multi-line display math is
  // handled by `multilineMathField` instead, since that needs `block: true`.
  const displayMode = m.kind === "math-display";
  const src = view.state.sliceDoc(m.from + (displayMode ? 2 : 1), m.to - (displayMode ? 2 : 1));
  if (!ensureKatexLoaded(view)) {
    // Still loading: leave the span exactly as syntax.ts's always-on pass already styles
    // it (plain coloured source text); katexReadyEffect triggers a rebuild once it's ready.
    return null;
  }
  return {
    from: m.from,
    to: m.to,
    deco: Decoration.replace({ widget: new MathWidget(src, displayMode, m.from) }),
  };
}

/** Every multi-line `$$…$$` block in the whole document (not viewport-scoped — this field
 * has no access to `view.visibleRanges`; display math is sparse enough that scanning the
 * full doc is cheap). CodeMirror only allows block-level replace decorations (needed since
 * the replaced range spans whole lines) to come from a `StateField`, never a `ViewPlugin`. */
function findMultilineMath(doc: EditorState["doc"]): InlineMarkMatch[] {
  const text = doc.toString();
  const matches: InlineMarkMatch[] = [];
  for (const m of text.matchAll(/\$\$[\s\S]*?\$\$/g)) {
    const from = m.index ?? 0;
    const to = from + m[0].length;
    if (doc.lineAt(from).number !== doc.lineAt(to).number) matches.push({ from, to, kind: "math-display" });
  }
  return matches;
}

function buildMultilineMath(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  for (const m of findMultilineMath(state.doc)) {
    if (touchesRange(state, m.from, m.to)) continue; // raw source stays visible, cursor inside
    const src = state.sliceDoc(m.from + 2, m.to - 2);
    const fromLine = state.doc.lineAt(m.from);
    const toLine = state.doc.lineAt(m.to);
    builder.add(
      fromLine.from,
      toLine.to,
      Decoration.replace({ widget: new MathWidget(src, true, m.from), block: true }),
    );
  }
  return builder.finish();
}

const multilineMathField = StateField.define<DecorationSet>({
  create: (state) => buildMultilineMath(state),
  update: (value, tr: Transaction) => {
    if (tr.docChanged || tr.selection || tr.effects.some((e) => e.is(katexReadyEffect))) {
      return buildMultilineMath(tr.state);
    }
    return value.map(tr.changes);
  },
  provide: (field) => EditorView.decorations.from(field),
});

/** Builds the live-preview extension. `citationTitles` (id → title) comes from the same
 * data completions.ts uses, reconfigured into the same Compartment whenever it changes. */
export function buildLivePreview(citationTitles: Map<string, string>): Extension {
  const viewportScoped = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = build(view, citationTitles);
      }
      update(u: ViewUpdate) {
        if (
          u.docChanged ||
          u.viewportChanged ||
          u.selectionSet ||
          u.transactions.some((tr) => tr.effects.some((e) => e.is(katexReadyEffect)))
        ) {
          this.decorations = build(u.view, citationTitles);
        }
      }
    },
    { decorations: (v) => v.decorations },
  );
  return [viewportScoped, multilineMathField];
}
