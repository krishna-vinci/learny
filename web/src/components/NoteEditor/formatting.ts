// Adapted from Memos (MIT) — https://github.com/usememos/memos
// Ported from MemoEditor/Editor/formatting.ts + the minimal command/active-state types from
// formatting/commands.ts and editorController.ts, plus the list indent/outdent helpers from
// Editor/listIndent.ts — trimmed to Studium's command set (bold/italic/code/code block,
// heading 1-3, bullet/ordered/task list, list indent/outdent, link) and extended with
// Studium-only commands: inline/display math, citation, callout, visual, youtube and table.

import { startCompletion } from "@codemirror/autocomplete";
import { syntaxTree } from "@codemirror/language";
import type { EditorView } from "@codemirror/view";

export type MarkCommand = "bold" | "italic" | "code";
export type ListCommand = "bulletList" | "orderedList" | "taskList";
export type HeadingCommand = "heading1" | "heading2" | "heading3";
export type CalloutName = "definition" | "theorem" | "example" | "deeper";
export const CALLOUT_NAMES: CalloutName[] = ["definition", "theorem", "example", "deeper"];

export type FormattingCommand =
  | MarkCommand
  | "codeBlock"
  | ListCommand
  | HeadingCommand
  | "link"
  | "inlineMath"
  | "displayMath"
  | "citation"
  | "callout"
  | "visual"
  | "youtube"
  | "table";

export interface FormattingCommandContext {
  calloutName?: CalloutName;
}

// One row per inline mark: the markdown token plus the syntax-tree wrapper and delimiter
// node names (verified against the Lezer markdown parser: StrongEmphasis/Emphasis use
// `EmphasisMark`, InlineCode uses `CodeMark`).
const MARKS: Record<MarkCommand, { token: string; wrapper: string; delimiter: string }> = {
  bold: { token: "**", wrapper: "StrongEmphasis", delimiter: "EmphasisMark" },
  italic: { token: "*", wrapper: "Emphasis", delimiter: "EmphasisMark" },
  code: { token: "`", wrapper: "InlineCode", delimiter: "CodeMark" },
};
const MARK_COMMANDS = Object.keys(MARKS) as MarkCommand[];
const DELIMITER_NODES = new Set(MARK_COMMANDS.map((c) => MARKS[c].delimiter));

const LIST_MARKERS: Record<ListCommand, string> = { bulletList: "- ", orderedList: "1. ", taskList: "- [ ] " };

const TASK_LINE = /^(\s*)[-*+]\s+\[[ xX]\]\s+/;
const BULLET_LINE = /^(\s*)[-*+]\s+/;
const ORDERED_LINE = /^(\s*)\d+[.)]\s+/;
/** ATX heading; shared with syntax.ts so decoration and command logic can't drift. */
export const HEADING_LINE = /^ {0,3}(#{1,6})\s+/;
const HEADING_PREFIX = /^ {0,3}(?:#{1,6}\s+)?/;

type Tree = ReturnType<typeof syntaxTree>;
type TreeNode = ReturnType<Tree["resolve"]>;

function* ancestors(tree: Tree, pos: number, side: -1 | 1): Generator<TreeNode> {
  for (let n: TreeNode | null = tree.resolve(pos, side); n; n = n.parent) {
    yield n;
  }
}

function childRanges(node: TreeNode, name: string): { from: number; to: number }[] {
  const ranges: { from: number; to: number }[] = [];
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.name === name) ranges.push({ from: child.from, to: child.to });
  }
  return ranges;
}

function wrapSelection(view: EditorView, token: string) {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: `${token}${sel}${token}` },
    selection: { anchor: from + token.length, head: from + token.length + sel.length },
  });
}

function findWrappedDelimiters(
  view: EditorView,
  wrapper: string,
  delimiter: string,
  minMarks: number,
): { from: number; to: number }[] | null {
  const { from, to, head } = view.state.selection.main;
  const tree = syntaxTree(view.state);
  const probes: [number, -1 | 1][] =
    from === to
      ? [[head, -1]]
      : [
          [head, -1],
          [from, 1],
          [to, -1],
        ];
  for (const [pos, side] of probes) {
    for (const n of ancestors(tree, pos, side)) {
      if (n.name !== wrapper) continue;
      const marks = childRanges(n, delimiter);
      if (marks.length >= minMarks) return marks;
    }
  }
  return null;
}

/** Toggle an inline mark (bold/italic/code), stripping the surrounding delimiter when the
 * selection already sits in one instead of nesting a new pair. */
export function toggleMark(view: EditorView, command: MarkCommand) {
  const { token, wrapper, delimiter } = MARKS[command];
  const marks = findWrappedDelimiters(view, wrapper, delimiter, 2);
  const opening = marks?.[0];
  const closing = marks ? marks[marks.length - 1] : undefined;
  if (opening && closing) {
    view.dispatch({
      changes: [
        { from: closing.from, to: closing.to, insert: "" },
        { from: opening.from, to: opening.to, insert: "" },
      ],
    });
    return;
  }
  const { from, to } = view.state.selection.main;
  if (
    from === to &&
    from >= token.length &&
    to + token.length <= view.state.doc.length &&
    view.state.sliceDoc(from - token.length, to + token.length) === token + token
  ) {
    const delFrom = from - token.length;
    const delTo = to + token.length;
    const tree = syntaxTree(view.state);
    const blocking = (n: TreeNode) => {
      if (!DELIMITER_NODES.has(n.name)) return false;
      const construct = n.parent ?? n;
      return construct.from < delFrom || construct.to > delTo;
    };
    if (!blocking(tree.resolve(from, -1)) && !blocking(tree.resolve(to, 1))) {
      view.dispatch({
        changes: [
          { from: delFrom, to: from, insert: "" },
          { from: to, to: delTo, insert: "" },
        ],
      });
      return;
    }
  }
  wrapSelection(view, token);
}

/** Toggle a fenced code block around the selected lines, or unwrap one the selection sits in. */
export function toggleCodeBlock(view: EditorView) {
  const { state } = view;
  const { from, to } = state.selection.main;
  const marks = findWrappedDelimiters(view, "FencedCode", "CodeMark", 1);
  const openMark = marks?.[0];
  if (marks && openMark) {
    const openLine = state.doc.lineAt(openMark.from);
    const openEnd = Math.min(openLine.to + 1, state.doc.length);
    const specs = [{ from: openLine.from, to: openEnd, insert: "" }];
    const lastMark = marks.length >= 2 ? marks[marks.length - 1] : undefined;
    if (lastMark) {
      const closeLine = state.doc.lineAt(lastMark.from);
      const closeIsLastLine = closeLine.to === state.doc.length;
      const closeTo = closeIsLastLine ? closeLine.to : closeLine.to + 1;
      const closeFrom = closeIsLastLine && closeLine.from - 1 >= openEnd ? closeLine.from - 1 : closeLine.from;
      specs.push({ from: closeFrom, to: closeTo, insert: "" });
    }
    const changes = state.changes(specs);
    view.dispatch({ changes, selection: state.selection.map(changes) });
    return;
  }
  const lineNumbers = selectedLineNumbers(view);
  const firstNumber = lineNumbers[0] ?? state.doc.lineAt(from).number;
  const lastNumber = lineNumbers[lineNumbers.length - 1] ?? firstNumber;
  const first = state.doc.line(firstNumber);
  const last = state.doc.line(lastNumber);
  const fence = "```";
  view.dispatch({
    changes: [
      { from: first.from, insert: `${fence}\n` },
      { from: last.to, insert: `\n${fence}` },
    ],
    selection: { anchor: from + fence.length + 1, head: to + fence.length + 1 },
  });
}

interface LineListInfo {
  mode: ListCommand | null;
  indent: number;
  markerEnd: number;
}

export const leadingWhitespace = (text: string): number => text.length - text.trimStart().length;

/** Unique line numbers covered by the selection, ascending. */
export function selectedLineNumbers(view: EditorView): number[] {
  const { doc, selection } = view.state;
  const nums = new Set<number>();
  for (const range of selection.ranges) {
    const last = doc.lineAt(range.to).number;
    for (let n = doc.lineAt(range.from).number; n <= last; n++) {
      nums.add(n);
    }
  }
  return [...nums].sort((a, b) => a - b);
}

function lineListInfo(text: string): LineListInfo {
  const task = TASK_LINE.exec(text);
  if (task) return { mode: "taskList", indent: (task[1] ?? "").length, markerEnd: task[0].length };
  const bullet = BULLET_LINE.exec(text);
  if (bullet) return { mode: "bulletList", indent: (bullet[1] ?? "").length, markerEnd: bullet[0].length };
  const ordered = ORDERED_LINE.exec(text);
  if (ordered) return { mode: "orderedList", indent: (ordered[1] ?? "").length, markerEnd: ordered[0].length };
  const indent = leadingWhitespace(text);
  return { mode: null, indent, markerEnd: indent };
}

/** Toggle/convert the list mode of the selected lines (mutually exclusive bullet/ordered/task). */
export function toggleListLine(view: EditorView, command: ListCommand) {
  const { state } = view;
  const lines = selectedLineNumbers(view).map((n) => state.doc.line(n));
  const nonBlank = lines.filter((line) => line.text.trim() !== "");
  const targets = lines.length === 1 || nonBlank.length === 0 ? lines : nonBlank;
  const infos = targets.map((line) => lineListInfo(line.text));
  const allOn = infos.every((info) => info.mode === command);

  const specs: { from: number; to: number; insert: string }[] = [];
  for (const [i, line] of targets.entries()) {
    const info = infos[i];
    if (!info) continue;
    const { mode, indent, markerEnd } = info;
    if (allOn) {
      specs.push({ from: line.from + indent, to: line.from + markerEnd, insert: "" });
    } else if (mode !== command) {
      const marker = command === "orderedList" ? `${i + 1}. ` : LIST_MARKERS[command];
      specs.push({ from: line.from + indent, to: line.from + markerEnd, insert: marker });
    }
  }
  if (specs.length === 0) return;
  const changes = state.changes(specs);
  view.dispatch({ changes, selection: state.selection.map(changes, 1) });
}

export function setHeading(view: EditorView, level: 1 | 2 | 3) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const existing = HEADING_PREFIX.exec(line.text)?.[0].length ?? 0;
  const currentLevel = HEADING_LINE.exec(line.text)?.[1]?.length ?? 0;
  const insert = currentLevel === level ? "" : `${"#".repeat(level)} `;
  const changes = view.state.changes({ from: line.from, to: line.from + existing, insert });
  view.dispatch({ changes, selection: view.state.selection.map(changes, 1) });
}

/** Unwrap the link the head sits in to its label text. True when one was found. */
function unwrapLink(view: EditorView): boolean {
  const head = view.state.selection.main.head;
  const tree = syntaxTree(view.state);
  for (const n of ancestors(tree, head, -1)) {
    if (n.name !== "Link") continue;
    const marks = childRanges(n, "LinkMark");
    const open = marks[0];
    const close = marks[1];
    if (!open || !close) continue;
    const label = view.state.sliceDoc(open.to, close.from);
    const anchor = n.from + Math.max(0, Math.min(label.length, head - open.to));
    view.dispatch({ changes: { from: n.from, to: n.to, insert: label }, selection: { anchor } });
    return true;
  }
  return false;
}

/** Toggle a link: unwrap an existing one around the cursor, else wrap the selection as
 * `[label]()` with the cursor left inside the (empty) url for the user to fill in. */
export function link(view: EditorView) {
  if (unwrapLink(view)) return;
  const { from, to } = view.state.selection.main;
  const label = view.state.sliceDoc(from, to);
  const insert = `[${label}]()`;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length - 1 } });
}

/** Wrap the selection in `$…$` (inline math). */
export function inlineMath(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to);
  view.dispatch({
    changes: { from, to, insert: `$${sel}$` },
    selection: { anchor: from + 1, head: from + 1 + sel.length },
  });
}

/** Insert `\n$$\n…\n$$\n` (display math) on its own lines around the selection. */
export function displayMath(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to);
  const prefix = "\n$$\n";
  const insert = `${prefix}${sel}\n$$\n`;
  const innerFrom = from + prefix.length;
  view.dispatch({
    changes: { from, to, insert },
    selection: { anchor: innerFrom, head: innerFrom + sel.length },
  });
}

/** Insert `[^src:` at the cursor and open the citation autocomplete. */
export function citation(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const insert = "[^src:";
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
  startCompletion(view);
}

/** Wrap the selection (or an empty line) in a `:::name{title="…"}` … `:::` callout, cursor
 * left inside the title quotes. */
export function callout(view: EditorView, name: CalloutName) {
  const { from, to } = view.state.selection.main;
  const sel = view.state.sliceDoc(from, to);
  const open = `:::${name}{title=""}\n`;
  const body = sel === "" ? "\n" : `${sel}\n`;
  const insert = `${open}${body}:::`;
  const titlePos = from + `:::${name}{title="`.length;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: titlePos } });
}

/** Insert `::visual{src="../visuals/" title=""}` on its own line at the cursor's line end,
 * cursor placed after the `../visuals/` prefix, and open the visuals autocomplete. */
export function visual(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const srcPrefix = '::visual{src="../visuals/';
  const insert = `\n${srcPrefix}" title=""}`;
  const srcPos = line.to + 1 + srcPrefix.length;
  view.dispatch({ changes: { from: line.to, to: line.to, insert }, selection: { anchor: srcPos } });
  startCompletion(view);
}

/** Insert `::youtube{src="" start=0}` on its own line at the cursor's line end, cursor
 * placed inside the (empty) src quotes. */
export function youtube(view: EditorView) {
  const line = view.state.doc.lineAt(view.state.selection.main.head);
  const srcPrefix = '::youtube{src="';
  const insert = `\n${srcPrefix}" start=0}`;
  const srcPos = line.to + 1 + srcPrefix.length;
  view.dispatch({ changes: { from: line.to, to: line.to, insert }, selection: { anchor: srcPos } });
}

/** Insert a 2×2 GFM table at the cursor, on its own line(s). */
export function table(view: EditorView) {
  const { from, to } = view.state.selection.main;
  const line = view.state.doc.lineAt(from);
  const leading = line.text.trim() === "" && from === line.from ? "" : "\n";
  const insert = `${leading}| Header | Header |\n| --- | --- |\n| Cell | Cell |\n| Cell | Cell |\n`;
  view.dispatch({ changes: { from, to, insert }, selection: { anchor: from + insert.length } });
}

/** Tab on a list item: nest it under the preceding item. False when not on a list item. */
export function sinkListItem(view: EditorView): boolean {
  const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s/;
  const LIST_PREFIX = /^\s*(?:[-*+]|\d+[.)])\s+/;
  const ORDERED_ITEM = /^(\s*)(\d+)([.)])(\s+)(.*)$/;
  const { doc } = view.state;

  function* previousListLines(from: number): Generator<{ text: string; indent: number }> {
    for (let p = from - 1; p >= 1; p--) {
      const { text } = doc.line(p);
      if (text.trim() === "") return;
      yield { text, indent: leadingWhitespace(text) };
    }
  }
  function nextOrderedNumber(lineNumber: number, indent: number): number {
    for (const prev of previousListLines(lineNumber)) {
      if (prev.indent < indent) break;
      if (prev.indent === indent) {
        const ordered = ORDERED_ITEM.exec(prev.text);
        return ordered ? Number.parseInt(ordered[2] ?? "0", 10) + 1 : 1;
      }
    }
    return 1;
  }
  function reindented(lineNumber: number, text: string, indent: number): string {
    const ordered = ORDERED_ITEM.exec(text);
    if (ordered) {
      const [, , , delimiter, spaces, content] = ordered;
      return `${" ".repeat(indent)}${nextOrderedNumber(lineNumber, indent)}${delimiter}${spaces}${content}`;
    }
    return " ".repeat(indent) + text.slice(leadingWhitespace(text));
  }

  const changes: { from: number; to: number; insert: string }[] = [];
  for (const n of selectedLineNumbers(view)) {
    const line = doc.line(n);
    const match = LIST_ITEM.exec(line.text);
    if (!match) return false;
    const indent = (match[1] ?? "").length;
    let target = indent + 2;
    for (const prev of previousListLines(n)) {
      if (prev.indent > indent) continue;
      const prevPrefix = LIST_PREFIX.exec(prev.text);
      if (prevPrefix) target = prevPrefix[0].length;
      break;
    }
    if (target > indent) {
      changes.push({ from: line.from, to: line.to, insert: reindented(n, line.text, target) });
    }
  }
  if (changes.length === 0) return false;
  view.dispatch({ changes, userEvent: "input.indent" });
  return true;
}

/** Shift-Tab on a list item: outdent it to its parent's indent. False when not applicable. */
export function liftListItem(view: EditorView): boolean {
  const LIST_ITEM = /^(\s*)(?:[-*+]|\d+[.)])\s/;
  const ORDERED_ITEM = /^(\s*)(\d+)([.)])(\s+)(.*)$/;
  const { doc } = view.state;

  function* previousListLines(from: number): Generator<{ text: string; indent: number }> {
    for (let p = from - 1; p >= 1; p--) {
      const { text } = doc.line(p);
      if (text.trim() === "") return;
      yield { text, indent: leadingWhitespace(text) };
    }
  }
  function nextOrderedNumber(lineNumber: number, indent: number): number {
    for (const prev of previousListLines(lineNumber)) {
      if (prev.indent < indent) break;
      if (prev.indent === indent) {
        const ordered = ORDERED_ITEM.exec(prev.text);
        return ordered ? Number.parseInt(ordered[2] ?? "0", 10) + 1 : 1;
      }
    }
    return 1;
  }
  function reindented(lineNumber: number, text: string, indent: number): string {
    const ordered = ORDERED_ITEM.exec(text);
    if (ordered) {
      const [, , , delimiter, spaces, content] = ordered;
      return `${" ".repeat(indent)}${nextOrderedNumber(lineNumber, indent)}${delimiter}${spaces}${content}`;
    }
    return " ".repeat(indent) + text.slice(leadingWhitespace(text));
  }

  const changes: { from: number; to: number; insert: string }[] = [];
  for (const n of selectedLineNumbers(view)) {
    const line = doc.line(n);
    const match = LIST_ITEM.exec(line.text);
    if (!match) return false;
    const indent = (match[1] ?? "").length;
    if (indent === 0) return false;
    let target = 0;
    for (const prev of previousListLines(n)) {
      if (prev.indent < indent) {
        target = LIST_ITEM.test(prev.text) ? prev.indent : 0;
        break;
      }
    }
    changes.push({ from: line.from, to: line.to, insert: reindented(n, line.text, target) });
  }
  if (changes.length === 0) return false;
  view.dispatch({ changes, userEvent: "delete.dedent" });
  return true;
}

/** Apply one formatting verb to a CodeMirror view. Shared by the toolbar and keymap. */
export function runFormattingCommand(
  view: EditorView,
  command: FormattingCommand,
  ctx?: FormattingCommandContext,
): void {
  switch (command) {
    case "bold":
    case "italic":
    case "code":
      toggleMark(view, command);
      return;
    case "codeBlock":
      toggleCodeBlock(view);
      return;
    case "bulletList":
    case "orderedList":
    case "taskList":
      toggleListLine(view, command);
      return;
    case "heading1":
      setHeading(view, 1);
      return;
    case "heading2":
      setHeading(view, 2);
      return;
    case "heading3":
      setHeading(view, 3);
      return;
    case "link":
      link(view);
      return;
    case "inlineMath":
      inlineMath(view);
      return;
    case "displayMath":
      displayMath(view);
      return;
    case "citation":
      citation(view);
      return;
    case "callout":
      callout(view, ctx?.calloutName ?? "definition");
      return;
    case "visual":
      visual(view);
      return;
    case "youtube":
      youtube(view);
      return;
    case "table":
      table(view);
      return;
  }
}
