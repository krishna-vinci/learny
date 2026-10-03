import { markdown } from "@codemirror/lang-markdown";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";
import { buildLivePreview } from "./livePreview";
import { noteSyntaxDecorations } from "./syntax";
import { noteEditorTheme } from "./theme";

/** A mounted EditorView (attached to the document, so it actually renders text/widgets)
 * with the given doc and cursor. `livePreview` defaults on; pass `[]` via the returned
 * compartment to simulate the "Show markdown" toggle. */
function mount(doc: string, anchor: number) {
  const compartment = new Compartment();
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new EditorView({
    parent: container,
    state: EditorState.create({
      doc,
      selection: { anchor },
      extensions: [markdown(), noteSyntaxDecorations, noteEditorTheme, compartment.of(buildLivePreview(new Map()))],
    }),
  });
  return { view, container, compartment };
}

function destroy(view: EditorView, container: HTMLElement) {
  view.destroy();
  container.remove();
}

// Safety net: if an assertion throws before a test's own `destroy()` call, don't leak
// detached-but-still-in-`document.body` containers (and their live EditorViews) into the
// next test.
afterEach(() => {
  document.body.replaceChildren();
});

/** Waits until `check()` returns true, re-checking every tick — used after a katex load
 * triggers an async decoration rebuild. */
async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("waitFor timed out");
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("live preview: markup hiding", () => {
  const doc = "# Heading\n\nSome **bold** and a [link](https://example.com) here.\n";

  it("hides markup off the active line and shows it dimmed on the active line", async () => {
    // Cursor on line 1 (the heading): that line is active, line 3 (bold/link) is not.
    const { view, container } = mount(doc, 0);
    await waitFor(() => container.textContent !== null);

    expect(container.textContent).toContain("# Heading"); // active line: marker visible
    expect(container.textContent).not.toContain("**"); // inactive line: markup hidden
    expect(container.textContent).not.toContain("](https://example.com)");
    expect(container.textContent).toContain("bold");
    expect(container.textContent).toContain("link");

    // Move the cursor into the bold/link line: it becomes active (markup reappears),
    // the heading line is no longer active (its `#` is hidden).
    const boldLine = doc.indexOf("**bold**") + 2;
    view.dispatch({ selection: { anchor: boldLine } });
    expect(container.textContent).toContain("**bold**");
    expect(container.textContent).toContain("[link](https://example.com)");
    expect(container.textContent).not.toMatch(/^# Heading/m);

    destroy(view, container);
  });
});

describe("live preview: math widget", () => {
  const doc = "x = $1+1$ end\n";
  const mathStart = doc.indexOf("$");
  const mathEnd = doc.indexOf("$ end") + 1;

  it("renders a katex widget only while the cursor is outside the math span", async () => {
    const { view, container } = mount(doc, 0); // cursor outside the math
    await waitFor(() => container.querySelector(".katex") !== null);
    expect(container.textContent).not.toContain("$1+1$");

    // Move the cursor inside the span: the widget gives way to raw source.
    view.dispatch({ selection: { anchor: mathStart + 2 } });
    expect(container.querySelector(".katex")).toBeNull();
    expect(container.textContent).toContain("$1+1$");

    // Move it back outside: the (now-cached) widget returns.
    view.dispatch({ selection: { anchor: mathEnd + 1 } });
    expect(container.querySelector(".katex")).not.toBeNull();
    expect(container.textContent).not.toContain("$1+1$");

    destroy(view, container);
  });
});

describe("live preview toggle", () => {
  const doc = "First line.\n\nSome **bold** text.\n";

  it("shows raw markdown (item 1 styling only) once the extension is reconfigured off", () => {
    // Cursor on the first line, so the bold line (below) starts out inactive/hidden.
    const { view, container, compartment } = mount(doc, 0);
    expect(container.textContent).not.toContain("**");

    view.dispatch({ effects: compartment.reconfigure([]) });
    expect(container.textContent).toContain("**bold**");
    // Item 1's mark is still applied (always on, independent of the toggle).
    expect(container.querySelector(".cm-sm-strong")).not.toBeNull();

    destroy(view, container);
  });
});
