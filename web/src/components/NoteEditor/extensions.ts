// Adapted from Memos (MIT) — https://github.com/usememos/memos
// Assembles the editor from MemoEditor/Editor/extensions.ts's shape (history, the
// formatting keymap ahead of defaultKeymap, Escape blurs, Tab/Shift-Tab list indent) —
// without Memos' tag/mention/upload/placeholder/focus-mode pieces — plus `@codemirror/search`
// (CodeMirror virtualises lines, so the browser's own find misses off-screen text) and
// Studium's syntax decorations, theme and autocompletion.
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { search, searchKeymap } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { EditorView, type KeyBinding, keymap } from "@codemirror/view";
import { liftListItem, runFormattingCommand, sinkListItem } from "./formatting";
import { noteSyntaxDecorations } from "./syntax";
import { noteEditorTheme } from "./theme";

const editorKeys: KeyBinding[] = [
  {
    key: "Escape",
    run: (view) => {
      view.contentDOM.blur();
      return true;
    },
  },
  { key: "Tab", run: sinkListItem },
  { key: "Shift-Tab", run: liftListItem },
];

const formattingKey = (key: string, command: "bold" | "italic" | "code"): KeyBinding => ({
  key,
  run: (view) => {
    runFormattingCommand(view, command);
    return true;
  },
});

const formattingKeys: KeyBinding[] = [
  formattingKey("Mod-b", "bold"),
  formattingKey("Mod-i", "italic"),
  formattingKey("Mod-e", "code"),
];

/** Build the editor's extensions. `completions` is the autocompletion extension built from
 * data fetched once per editor open (see completions.ts / CodeMirrorNoteEditor.tsx). */
export function buildNoteEditorExtensions(completions: Extension): Extension[] {
  return [
    history(),
    markdown(),
    EditorView.lineWrapping,
    noteSyntaxDecorations,
    noteEditorTheme,
    completions,
    search({ top: true }),
    // Formatting/editor keys precede defaultKeymap so Mod-b/i/e and Tab/Shift-Tab win over
    // CodeMirror's generic bindings; indentWithTab is the plain-indent fallback when
    // Tab/Shift-Tab aren't on a list item.
    keymap.of([...editorKeys, ...formattingKeys, ...searchKeymap, indentWithTab, ...defaultKeymap, ...historyKeymap]),
  ];
}
