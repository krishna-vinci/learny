import { EditorView } from "@codemirror/view";

/**
 * Editor chrome, syntax.ts's markup classes (item 1, always on) and livePreview.ts's/
 * mathWidget.ts's live-preview classes (items 2–4, toggled off by "Show markdown") —
 * styled entirely from Studium's CSS variables (index.css) — no literal colours — so the
 * editor reads correctly in all five themes (light/dark/sepia/black/system). Normal text
 * uses the reader's prose font (`--font-sans`, matching `.studium-prose`); code, fenced
 * blocks and frontmatter (`.cm-sm-mono`) stay on `--font-mono`. Font size is 16px below
 * 768px to stop iOS Safari zooming the page on focus, 14px above.
 */
export const noteEditorTheme = EditorView.theme({
  "&": {
    height: "100%",
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
  },
  "&.cm-editor.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-sans)",
    lineHeight: "1.6",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "0.75rem 1rem",
    caretColor: "var(--foreground)",
    fontSize: "15px",
  },
  ".cm-gutters": { display: "none" },
  ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
    backgroundColor: "color-mix(in oklch, var(--primary) 30%, transparent)",
  },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
  ".cm-activeLine": { backgroundColor: "transparent" },
  ".cm-tooltip-autocomplete": {
    backgroundColor: "var(--popover)",
    color: "var(--popover-foreground)",
    border: "1px solid var(--border)",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "var(--accent)",
    color: "var(--accent-foreground)",
  },
  ".cm-panels": {
    backgroundColor: "var(--background)",
    color: "var(--foreground)",
  },
  ".cm-panels.cm-panels-top": { borderBottom: "1px solid var(--border)" },
  ".cm-searchMatch": { backgroundColor: "color-mix(in oklch, var(--primary) 25%, transparent)" },
  ".cm-searchMatch-selected": { backgroundColor: "color-mix(in oklch, var(--primary) 45%, transparent)" },

  // syntax.ts — always on, regardless of the live-preview toggle.
  ".cm-sm-mono": { fontFamily: "var(--font-mono)" },
  ".cm-sm-frontmatter": { color: "var(--muted-foreground)" },
  ".cm-sm-math": { color: "var(--primary)" },
  ".cm-sm-citation": { color: "var(--primary)", fontWeight: "500" },
  ".cm-sm-directive": { color: "var(--primary)" },
  ".cm-sm-quote": { color: "var(--muted-foreground)", fontStyle: "italic" },
  ".cm-sm-strong": { fontWeight: "600" },
  ".cm-sm-emphasis": { fontStyle: "italic" },
  ".cm-sm-strike": { textDecoration: "line-through" },
  ".cm-sm-inlinecode": {
    color: "var(--foreground)",
    background: "var(--muted)",
    borderRadius: "0.25rem",
    padding: "0.05em 0.3em",
  },
  ".cm-sm-linktext": { color: "var(--primary)", textDecoration: "underline", textUnderlineOffset: "2px" },
  ".cm-sm-url": { color: "var(--muted-foreground)" },
  ".cm-sm-h1": { fontWeight: "700", fontSize: "1.75em", lineHeight: "1.3" },
  ".cm-sm-h2": { fontWeight: "700", fontSize: "1.4em", lineHeight: "1.3" },
  ".cm-sm-h3": { fontWeight: "700", fontSize: "1.15em", lineHeight: "1.3" },
  ".cm-sm-h4, .cm-sm-h5, .cm-sm-h6": { fontWeight: "700" },

  // livePreview.ts / mathWidget.ts — only while the toggle is on.
  ".cm-sm-markup-dim": { color: "var(--muted-foreground)" },
  ".cm-sm-math-widget": {
    display: "inline-block",
    cursor: "text",
    verticalAlign: "middle",
  },
  ".cm-sm-math-widget.cm-sm-math-widget-block": {
    display: "block",
    margin: "0.5em 0",
    overflowX: "auto",
  },
  ".cm-sm-math-loading": {
    color: "var(--primary)",
    fontFamily: "var(--font-mono)",
    opacity: "0.7",
  },
  ".cm-sm-chip": {
    display: "inline-flex",
    alignItems: "center",
    gap: "0.25em",
    borderRadius: "999px",
    background: "var(--muted)",
    color: "var(--muted-foreground)",
    padding: "0 0.5em",
    fontSize: "0.8em",
    fontFamily: "var(--font-sans)",
    cursor: "text",
    verticalAlign: "middle",
  },
  ".cm-sm-citation-chip": {
    display: "inline",
    borderRadius: "0.25em",
    background: "var(--muted)",
    color: "var(--primary)",
    padding: "0 0.35em",
    fontSize: "0.75em",
    verticalAlign: "super",
    cursor: "text",
  },
  ".cm-sm-directive-chip": {
    display: "block",
    borderRadius: "0.375rem",
    border: "1px solid var(--border)",
    background: "var(--muted)",
    color: "var(--muted-foreground)",
    padding: "0.35em 0.6em",
    fontSize: "0.875em",
    fontFamily: "var(--font-sans)",
    cursor: "text",
  },
  ".cm-sm-callout-open": {
    display: "block",
    color: "var(--muted-foreground)",
    fontSize: "0.75em",
    fontWeight: "600",
    textTransform: "uppercase",
    letterSpacing: "0.03em",
    fontFamily: "var(--font-sans)",
    cursor: "text",
  },
  ".cm-sm-callout-close": { color: "var(--muted-foreground)" },

  "@media (max-width: 767px)": {
    ".cm-content": { fontSize: "16px" },
  },
});
