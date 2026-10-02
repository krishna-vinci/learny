import type { FileView } from "@studium/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { Reader } from "./Reader";

vi.mock("@/api/queries", async (original) => ({
  ...(await original<typeof import("@/api/queries")>()),
  useHighlights: () => ({ data: { highlights: [] }, isError: false }),
}));
vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => false }));

function Location() {
  const location = useLocation();
  const navigate = useNavigate();
  return (
    <>
      <output aria-label="Location">{location.search}</output>
      <button type="button" onClick={() => navigate(-1)}>
        Go back
      </button>
    </>
  );
}
const body = '# Vectors\n\nRead this explanation.\n\n::artifact{src="../artifacts/vectors.html" title="Move a vector"}';
function mount(content = body, search = "") {
  const file: FileView = { path: "notes/vectors.md", raw: content, body: content, frontmatter: { title: "Vectors" } };
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/s/alpha/n/notes/vectors.md${search}`]}>
        <Reader set="alpha" path="notes/vectors.md" file={file} />
        <Location />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
// jsdom does not implement scrollIntoView; the rail uses it to keep the active card visible.
Element.prototype.scrollIntoView = Element.prototype.scrollIntoView ?? (() => {});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  sessionStorage.clear();
});

it("switches chapter views, preserves reading scroll and stops the sandbox on return or browser back", async () => {
  const fetch = vi.fn(async () => ({ ok: true, json: async () => ({ raw: "<p>Simulation</p>" }) }));
  vi.stubGlobal("fetch", fetch);
  const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  Object.defineProperty(document.documentElement, "scrollHeight", { configurable: true, value: 3000 });
  mount();
  expect(screen.getByRole("tab", { name: "Reading" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("Read this explanation.")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Run" })).toBeNull();
  Object.defineProperty(window, "scrollY", { configurable: true, value: 240 });
  fireEvent.click(screen.getByRole("tab", { name: "Visuals (1)" }));
  expect(screen.getByLabelText("Location").textContent).toBe("?view=visuals");
  expect(screen.queryByText("Read this explanation.")).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  fireEvent.click(await screen.findByRole("button", { name: "Run" }));
  await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
  Object.defineProperty(window, "scrollY", { configurable: true, value: 500 });
  fireEvent.scroll(window);
  expect(sessionStorage.getItem("studium.note-scroll:alpha/notes/vectors.md")).toBe("240");
  fireEvent.click(screen.getByRole("button", { name: "Go back" }));
  await screen.findByText("Read this explanation.");
  expect(document.querySelector("iframe")).toBeNull();
  expect(scrollTo).toHaveBeenCalledWith(0, 240);
  fireEvent.click(screen.getByRole("tab", { name: "Visuals (1)" }));
  expect(await screen.findByRole("button", { name: "Run" })).toBeTruthy();
  expect(document.querySelector("iframe")).toBeNull();
  fireEvent.click(screen.getByRole("tab", { name: "Reading" }));
  expect(screen.getByText("Read this explanation.")).toBeTruthy();
});

it("opens a linked Visuals tab and gives an empty chapter a return action", async () => {
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  mount("# Empty chapter\n\nPlain text.", "?view=visuals");
  expect(screen.getByRole("tab", { name: "Visuals" }).getAttribute("aria-selected")).toBe("true");
  expect(screen.getByText("No visuals in this chapter yet")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Return to reading" }));
  expect(await screen.findByText("Plain text.")).toBeTruthy();
});

// ── Stage + rail (D31/D32 pass 2) ─────────────────────────────────────────────

const WIDGET_JSON = JSON.stringify({
  type: "function-plot",
  title: "Slope",
  x: [-3, 3],
  y: [-3, 3],
  xLabel: "x",
  yLabel: "y",
  curves: [{ expression: "a*x", label: "y = ax" }],
  params: [{ name: "a", min: 0, max: 2, value: 1 }],
  story: {
    scenes: [
      { state: { a: 1 }, narration: "At unit slope the input and output match." },
      { state: { a: 2 }, narration: "Doubling the slope doubles each output." },
    ],
  },
});
const SKETCH_HTML =
  '<script type="application/json" id="studium-visual">{"libs":["d3"],"poster":"x.svg"}</script><p>Demo</p>';
const MANIFEST = { d3: "d3.012345abcdef.js", "studium-runtime": "studium-runtime.012345abcdef.js" };
const MULTI_BODY = `# Chapter

Prose.

::visual{src="../visuals/slope.json" title="Slope"}
::visual{src="../visuals/stretch.html" poster="../visuals/stretch.svg" title="Stretch"}
::artifact{src="../artifacts/demo.html" poster="../artifacts/demo.svg" title="Move"}
`;

function stubVisualFetch(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = String(input);
      for (const [key, value] of Object.entries(overrides)) if (url.includes(key)) return value;
      if (url.includes("manifest.json")) return { ok: true, json: async () => MANIFEST };
      if (url.includes("slope.json")) return { ok: true, json: async () => ({ raw: WIDGET_JSON }) };
      if (url.includes("stretch.html")) return { ok: true, json: async () => ({ raw: SKETCH_HTML }) };
      return { ok: true, json: async () => ({ raw: "<p>artifact</p>" }) };
    }),
  );
}

it("stages one visual at a time behind a rail and pushes history per stage", async () => {
  stubVisualFetch();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  mount(MULTI_BODY, "?view=visuals");
  const rail = screen.getByRole("group", { name: "Chapter visuals" });
  expect(rail.querySelectorAll("button")).toHaveLength(3);
  await screen.findByRole("application", { name: "Slope controls" });
  expect(document.querySelectorAll("section h2")).toHaveLength(1);
  // The widget's default state doubles as its rail thumbnail.
  expect(rail.querySelector("svg")).not.toBeNull();
  fireEvent.click(within(rail).getByRole("button", { name: "Stretch" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Stretch" })).toBeTruthy());
  await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
  expect(screen.getByLabelText("Location").textContent).toContain("v=stretch");
  expect(screen.queryByRole("heading", { name: "Slope" })).toBeNull();
  expect(document.querySelectorAll("section h2")).toHaveLength(1);
  fireEvent.click(screen.getByRole("button", { name: "Go back" }));
  await screen.findByRole("application", { name: "Slope controls" });
  expect(screen.getByLabelText("Location").textContent).not.toContain("v=stretch");
});

it("deep-links by stem, falls back to the first visual for unknown ids, hides the rail for one", async () => {
  stubVisualFetch();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  mount(MULTI_BODY, "?view=visuals&v=stretch");
  await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
  cleanup();
  stubVisualFetch();
  mount(MULTI_BODY, "?view=visuals&v=does-not-exist");
  await screen.findByRole("application", { name: "Slope controls" });
  cleanup();
  stubVisualFetch();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  mount('# One\n\nProse.\n\n::visual{src="../visuals/slope.json" title="Slope"}\n', "?view=visuals");
  await screen.findByRole("application", { name: "Slope controls" });
  expect(screen.queryByRole("group", { name: "Chapter visuals" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Previous visual" })).toBeNull();
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
});

it("moves the stage with Shift+arrows only; plain arrows stay with the focused widget", async () => {
  stubVisualFetch();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  mount(MULTI_BODY, "?view=visuals");
  await screen.findByRole("application", { name: "Slope controls" });
  const bar = screen.getByText("Visuals · 3 in this chapter");
  fireEvent.keyDown(bar, { key: "ArrowRight", shiftKey: true });
  await waitFor(() => expect(screen.getByRole("heading", { name: "Stretch" })).toBeTruthy());
  // Plain arrows must not change the stage; they belong to the widget/sketch scenes.
  fireEvent.keyDown(bar, { key: "ArrowLeft" });
  expect(screen.getByRole("heading", { name: "Stretch" })).toBeTruthy();
  fireEvent.keyDown(bar, { key: "ArrowLeft", shiftKey: true });
  await waitFor(() => expect(screen.getByRole("heading", { name: "Slope" })).toBeTruthy());
  // At the first visual, Shift+Left stays put.
  fireEvent.keyDown(bar, { key: "ArrowLeft", shiftKey: true });
  expect(screen.getByRole("heading", { name: "Slope" })).toBeTruthy();
  // Plain arrows still step scenes when the widget itself has focus.
  await screen.findByRole("application", { name: "Slope controls" });
  fireEvent.keyDown(screen.getByRole("application", { name: "Slope controls" }), { key: "ArrowRight" });
  await waitFor(() => expect(screen.getByText("Doubling the slope doubles each output.")).toBeTruthy());
});

it("gives every kind a strip with kind-appropriate controls", async () => {
  stubVisualFetch();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  mount(MULTI_BODY, "?view=visuals");
  await screen.findByRole("application", { name: "Slope controls" });
  // Widget: play/pause + scene stepper + restart + expand + prev/next visual.
  expect(screen.getByRole("button", { name: "Play" })).toBeTruthy();
  await screen.findByRole("button", { name: "Previous scene" });
  expect(screen.getByRole("button", { name: "Next scene" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Next scene" }));
  await waitFor(() => expect(screen.getByText("2/2")).toBeTruthy());
  expect(screen.getByRole("button", { name: "Restart" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Full screen" })).toBeTruthy();
  // Sketch: play/pause + restart + expand, but no scene stepper (in-frame chrome owns scenes);
  // the middle stage is where both prev/next visual controls appear.
  fireEvent.click(screen.getByRole("button", { name: "Next visual" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Stretch" })).toBeTruthy());
  await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
  expect(screen.getByRole("button", { name: "Pause" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Restart" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Previous visual" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Previous scene" })).toBeNull();
  // Legacy artifact: restart + expand only, and only after Run.
  fireEvent.click(screen.getByRole("button", { name: "Next visual" }));
  await waitFor(() => expect(screen.getByRole("heading", { name: "Move" })).toBeTruthy());
  expect(screen.queryByRole("button", { name: "Restart" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Run" }));
  await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
  expect(screen.getByRole("button", { name: "Restart" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Play" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Pause" })).toBeNull();
});

it("shows the sketch poster immediately and hides it once the live sketch is ready", async () => {
  let resolveStretch!: (response: unknown) => void;
  stubVisualFetch({
    "stretch.html": new Promise((resolve) => {
      resolveStretch = resolve;
    }),
  });
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  mount(MULTI_BODY, "?view=visuals&v=stretch");
  expect(await screen.findByAltText("Stretch")).toBeTruthy();
  expect(document.querySelector("iframe")).toBeNull();
  expect(screen.queryByLabelText("Opening visual")).toBeNull();
  await act(async () => {
    resolveStretch({ ok: true, json: async () => ({ raw: SKETCH_HTML }) });
  });
  await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
  // jsdom never executes the bundled runtime; deliver its ready signal by hand.
  const frame = document.querySelector("iframe") as HTMLIFrameElement;
  const ready = new MessageEvent("message", { data: { type: "studium-visual", event: "ready" } });
  Object.defineProperty(ready, "source", { value: frame.contentWindow });
  window.dispatchEvent(ready);
  await waitFor(() => expect(screen.queryByAltText("Stretch")).toBeNull());
});

it("whispers at the end of the reading panel only when the chapter has visuals", async () => {
  stubVisualFetch();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  mount(MULTI_BODY);
  const whisper = screen.getByRole("button", { name: "Explore this chapter's 3 visuals →" });
  fireEvent.click(whisper);
  expect(await screen.findByRole("heading", { name: "Slope" })).toBeTruthy();
  expect(screen.getByLabelText("Location").textContent).toContain("view=visuals");
  cleanup();
  vi.spyOn(window, "scrollTo").mockImplementation(() => {});
  mount("# Empty\n\nPlain text.");
  expect(screen.queryByRole("button", { name: /Explore this chapter's/ })).toBeNull();
});
