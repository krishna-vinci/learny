import { markdown } from "@codemirror/lang-markdown";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { callout, citation, displayMath, inlineMath, table, toggleMark, visual, youtube } from "./formatting";

/** A detached EditorView (no DOM measurement needed for dispatch-only commands) with the
 * given doc and selection, so each command can be exercised as it would run against the
 * real editor's syntax tree. */
function viewWith(doc: string, anchor: number, head = anchor): EditorView {
  return new EditorView({
    state: EditorState.create({
      doc,
      selection: { anchor, head },
      extensions: [markdown()],
    }),
  });
}

describe("toggleMark", () => {
  it("wraps a selection in ** and toggles it back off", () => {
    const view = viewWith("hello world", 0, 5);
    toggleMark(view, "bold");
    expect(view.state.doc.toString()).toBe("**hello** world");
    toggleMark(view, "bold");
    expect(view.state.doc.toString()).toBe("hello world");
  });

  it("wraps a selection in * for italic", () => {
    const view = viewWith("hello world", 0, 5);
    toggleMark(view, "italic");
    expect(view.state.doc.toString()).toBe("*hello* world");
  });
});

describe("inlineMath", () => {
  it("wraps the selection in $…$", () => {
    const view = viewWith("let x = 1", 8, 9);
    inlineMath(view);
    expect(view.state.doc.toString()).toBe("let x = $1$");
    expect(view.state.selection.main).toMatchObject({ from: 9, to: 10 });
  });

  it("inserts an empty pair at the cursor with nothing selected", () => {
    const view = viewWith("", 0);
    inlineMath(view);
    expect(view.state.doc.toString()).toBe("$$");
    expect(view.state.selection.main.head).toBe(1);
  });
});

describe("displayMath", () => {
  it("inserts \\n$$\\n…\\n$$\\n around the selection", () => {
    const view = viewWith("E = mc^2", 0, 8);
    displayMath(view);
    expect(view.state.doc.toString()).toBe("\n$$\nE = mc^2\n$$\n");
    const sel = view.state.selection.main;
    expect(view.state.sliceDoc(sel.from, sel.to)).toBe("E = mc^2");
  });
});

describe("citation", () => {
  it("inserts [^src: at the cursor", () => {
    const view = viewWith("see ", 4);
    citation(view);
    expect(view.state.doc.toString()).toBe("see [^src:");
    expect(view.state.selection.main.head).toBe(10);
  });
});

describe("callout", () => {
  it('wraps a selection in :::name{title=""} … :::', () => {
    const view = viewWith("important fact", 0, 14);
    callout(view, "definition");
    expect(view.state.doc.toString()).toBe(':::definition{title=""}\nimportant fact\n:::');
  });

  it("wraps an empty line when nothing is selected", () => {
    const view = viewWith("", 0);
    callout(view, "theorem");
    expect(view.state.doc.toString()).toBe(':::theorem{title=""}\n\n:::');
  });
});

describe("visual", () => {
  it('inserts ::visual{src="../visuals/" title=""} on its own line at the cursor\'s line end', () => {
    const view = viewWith("# Chapter", 9);
    visual(view);
    expect(view.state.doc.toString()).toBe('# Chapter\n::visual{src="../visuals/" title=""}');
  });
});

describe("youtube", () => {
  it('inserts ::youtube{src="" start=0} on its own line', () => {
    const view = viewWith("# Chapter", 9);
    youtube(view);
    expect(view.state.doc.toString()).toBe('# Chapter\n::youtube{src="" start=0}');
  });
});

describe("table", () => {
  it("inserts a 2x2 GFM table at the cursor", () => {
    const view = viewWith("", 0);
    table(view);
    expect(view.state.doc.toString()).toBe("| Header | Header |\n| --- | --- |\n| Cell | Cell |\n| Cell | Cell |\n");
  });
});
