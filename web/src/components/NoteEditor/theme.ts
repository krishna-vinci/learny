import { EditorView } from "@codemirror/view";

/**
 * Editor chrome and the syntax.ts decoration classes, styled entirely from Studium's CSS
 * variables (index.css) — no literal colours — so the editor reads correctly in all five
 * themes (light/dark/sepia/black/system) without its own palette. Font size is 16px below
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
    fontFamily: "var(--font-mono)",
    lineHeight: "1.6",
    overflow: "auto",
  },
  ".cm-content": {
    padding: "0.75rem 1rem",
    caretColor: "var(--foreground)",
    fontSize: "14px",
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
  // Studium syntax decorations (syntax.ts) — classes only, colours from here.
  ".cm-sm-frontmatter": { color: "var(--muted-foreground)" },
  ".cm-sm-math": { color: "var(--primary)" },
  ".cm-sm-citation": { color: "var(--primary)", fontWeight: "500" },
  ".cm-sm-directive": { color: "var(--primary)" },
  ".cm-sm-h1, .cm-sm-h2, .cm-sm-h3, .cm-sm-h4, .cm-sm-h5, .cm-sm-h6": { fontWeight: "700" },
  "@media (max-width: 767px)": {
    ".cm-content": { fontSize: "16px" },
  },
});
