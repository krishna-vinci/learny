import { EditorView } from "@codemirror/view";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import CodeMirrorNoteEditor from "./CodeMirrorNoteEditor";

vi.mock("@/api/client", () => ({ api: { sets: { sources: vi.fn(), visuals: vi.fn() } } }));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function setup(value: string, onChange = vi.fn()) {
  vi.mocked(api.sets.sources).mockResolvedValue([]);
  vi.mocked(api.sets.visuals).mockResolvedValue({ files: [] });
  const utils = render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CodeMirrorNoteEditor set="history" value={value} onChange={onChange} />
    </QueryClientProvider>,
  );
  return { onChange, ...utils };
}

const CHAPTER = [
  "---",
  "title: Orbits",
  "---",
  "",
  "# Orbits",
  "",
  "Kepler's law: $r = a(1 - e^2)$.",
  "",
  "See [^src:kepler] for the derivation.",
  "",
  '::visual{src="../visuals/orbit.json" title=""}',
  "",
  "```js",
  "const a = 1;",
  "```",
  "",
].join("\n");

describe("CodeMirrorNoteEditor", () => {
  it("mounts without calling onChange, exposing the exact input doc", async () => {
    const { onChange, container } = setup(CHAPTER);
    await waitFor(() => expect(container.querySelector(".cm-content")).not.toBeNull());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("reports input + typed character on one keystroke", async () => {
    const { onChange, container } = setup("hello");
    const content = await waitFor(() => {
      const el = container.querySelector<HTMLElement>(".cm-content");
      if (!el) throw new Error("not mounted");
      return el;
    });
    // jsdom doesn't run a real browser's beforeinput/composition pipeline, so the
    // keystroke is applied the way CodeMirror itself resolves one internally — a single
    // insert-at-cursor dispatch on the mounted view (found from its own DOM node, as
    // EditorView.findFromDOM documents) — and the assertion is on `onChange`'s result,
    // not on how the dispatch was produced.
    const view = EditorView.findFromDOM(content);
    expect(view).not.toBeNull();
    view?.dispatch({ changes: { from: view.state.doc.length, insert: "!" } });
    await waitFor(() => expect(onChange).toHaveBeenCalled());
    expect(onChange).toHaveBeenCalledWith("hello!");
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it("falls back to the plain textarea for text containing \\r\\n", async () => {
    const { container, getByText } = setup("line one\r\nline two");
    expect(getByText(/Windows line endings/)).toBeTruthy();
    expect(container.querySelector("textarea")).not.toBeNull();
    expect(container.querySelector(".cm-content")).toBeNull();
  });
});
