import type { ChapterVisual } from "@studium/shared/media";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VisualBlock } from "./VisualBlock";

// `vitest.config.ts` runs with `globals: false`, so @testing-library/react's automatic
// afterEach cleanup never registers itself; without this each render stacks onto the last DOM.
// VisualBlock observes visibility via IntersectionObserver, which jsdom does not implement.
let callbacks: IntersectionObserverCallback[] = [];
beforeEach(() => {
  callbacks = [];
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      constructor(cb: IntersectionObserverCallback) {
        callbacks.push(cb);
      }
      observe() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const WIDGET_JSON = JSON.stringify({
  type: "function-plot",
  title: "Slope",
  x: [-3, 3],
  y: [-3, 3],
  xLabel: "x",
  yLabel: "y",
  curves: [{ expression: "a*x", label: "y = ax" }],
  params: [{ name: "a", min: 0, max: 2, value: 1 }],
});
const SKETCH =
  '<script type="application/json" id="studium-visual">{"libs":["d3"],"poster":"x.svg"}</script><p>Demo</p>';
const MANIFEST = { d3: "d3.012345abcdef.js", "studium-runtime": "studium-runtime.012345abcdef.js" };

const widget: ChapterVisual = { title: "Slope", src: "alpha/visuals/slope.json", kind: "widget" };
const sketch: ChapterVisual = { title: "Demo", src: "alpha/visuals/demo.html", kind: "sketch" };

describe("VisualBlock", () => {
  it("renders a widget with no iframe and a full-screen control", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ raw: WIDGET_JSON }) })),
    );
    render(<VisualBlock visual={widget} />);
    await waitFor(() => expect(screen.getByRole("img", { name: "Slope" })).toBeTruthy());
    expect(document.querySelector("iframe")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(screen.getByRole("img", { name: "Slope" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Exit full screen" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(screen.getByRole("img", { name: "Slope" })).toBeTruthy();
  });

  it("keeps the same iframe element and srcdoc across full-screen toggles", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("manifest.json")
          ? { ok: true, json: async () => MANIFEST }
          : { ok: true, json: async () => ({ raw: SKETCH }) },
      ),
    );
    render(<VisualBlock visual={sketch} />);
    const frame = await waitFor(() => {
      const element = document.querySelector("iframe");
      expect(element).not.toBeNull();
      return element as Element;
    });
    const srcdoc = frame.getAttribute("srcdoc");
    fireEvent.click(screen.getByRole("button", { name: "Full screen" }));
    expect(document.querySelector("iframe")).toBe(frame);
    expect(document.querySelector("iframe")?.getAttribute("srcdoc")).toBe(srcdoc);
    fireEvent.click(screen.getByRole("button", { name: "Exit full screen" }));
    expect(document.querySelector("iframe")).toBe(frame);
  });

  it("separates content failures from connection failures", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ raw: "{bad widget}" }) })),
    );
    const broken = render(<VisualBlock visual={widget} />);
    expect(await broken.findByText("This visual has a problem and can't be shown.")).toBeTruthy();
    expect(broken.queryByRole("button", { name: "Try again" })).toBeNull();
    cleanup();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ raw: WIDGET_JSON }) })),
    );
    const outside = render(<VisualBlock visual={{ title: "Bad", src: "alpha/notes/bad.json", kind: "widget" }} />);
    expect(await outside.findByText("This visual has a problem and can't be shown.")).toBeTruthy();
    cleanup();

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ raw: WIDGET_JSON }) });
    vi.stubGlobal("fetch", fetchMock);
    render(<VisualBlock visual={widget} />);
    expect(await screen.findByText("This visual needs a connection.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getByRole("img", { name: "Slope" })).toBeTruthy());
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
