import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sketchCsp } from "@/visual-runtime/sandbox";
import type { VisualTheme } from "@/visual-runtime/theme";
import { SketchBlock } from "./SketchBlock";

// `vitest.config.ts` runs with `globals: false`, so @testing-library/react's automatic
// afterEach cleanup never registers itself; without this each render stacks onto the last DOM.
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const manifest = {
  p5: "p5.012345abcdef.js",
  d3: "d3.012345abcdef.js",
  three: "three.012345abcdef.js",
  "studium-runtime": "studium-runtime.012345abcdef.js",
};
const SKETCH =
  '<script type="application/json" id="studium-visual">{"libs":["d3"],"poster":"x.svg"}</script><p>Demo</p>';
const THEME: VisualTheme = {
  bg: "#fff",
  fg: "#000",
  muted: "#777",
  accent: "#0072B2",
  grid: "#ddd",
  font: "system-ui",
  palette: ["#0072B2"],
  dark: false,
};

function runtimeScripts(srcdoc: string): string[] {
  return [...srcdoc.matchAll(/<script src="([^"]+)" crossorigin/g)].map((match) => match[1] ?? "");
}

describe("SketchBlock", () => {
  it("mounts the frame with the exact sandbox, first-document CSP and only declared libraries", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => manifest })),
    );
    render(<SketchBlock html={SKETCH} title="Demo" active reduced={false} theme={THEME} />);
    const frame = await waitFor(() => {
      const element = document.querySelector("iframe");
      expect(element).not.toBeNull();
      return element as Element;
    });
    expect(frame.getAttribute("sandbox")).toBe("allow-scripts");
    expect(frame.getAttribute("referrerpolicy")).toBe("no-referrer");
    const srcdoc = frame.getAttribute("srcdoc") ?? "";
    expect(srcdoc.startsWith(sketchCsp(location.origin))).toBe(true);
    expect(runtimeScripts(srcdoc)).toEqual([
      `${location.origin}/visual-runtime/d3.012345abcdef.js`,
      `${location.origin}/visual-runtime/studium-runtime.012345abcdef.js`,
    ]);
    expect(srcdoc).not.toContain("/p5.");
    expect(srcdoc).not.toContain("/three.");
  });

  it("renders no iframe until the runtime document is built", async () => {
    let resolveManifest: (response: unknown) => void = () => {};
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise((resolve) => (resolveManifest = resolve))),
    );
    render(<SketchBlock html={SKETCH} title="Demo" active reduced={false} theme={THEME} />);
    await waitFor(() => expect(screen.getByLabelText("Opening visual")).toBeTruthy());
    expect(document.querySelector("iframe")).toBeNull();
    resolveManifest({ ok: true, json: async () => manifest });
    await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
  });

  it("separates a connection failure (retry) from a broken sketch (no retry)", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ ok: true, json: async () => manifest });
    vi.stubGlobal("fetch", fetchMock);
    render(<SketchBlock html={SKETCH} title="Demo" active reduced={false} theme={THEME} />);
    expect(await screen.findByText("This visual needs a connection.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
    expect(fetchMock).toHaveBeenCalledTimes(2);
    cleanup();

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => manifest })),
    );
    render(<SketchBlock html="<p>No header here</p>" title="Demo" active reduced={false} theme={THEME} />);
    expect(await screen.findByText("This visual has a problem and can't be shown.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
    expect(screen.getByText("Sketch needs an application/json studium-visual header")).toBeTruthy();
  });

  it("ignores foreign postMessage sources but restarts on a runtime error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => manifest })),
    );
    render(<SketchBlock html={SKETCH} title="Demo" active reduced={false} theme={THEME} />);
    const frame = await waitFor(() => {
      const element = document.querySelector("iframe");
      expect(element).not.toBeNull();
      return element as HTMLIFrameElement;
    });
    // A message whose source is not this frame must be ignored.
    window.dispatchEvent(
      new MessageEvent("message", { data: { type: "studium-visual", event: "error", message: "forged" } }),
    );
    await waitFor(() => expect(frame.getAttribute("srcdoc")).not.toBe(""));
    expect(screen.queryByText("This visual stopped with an error.")).toBeNull();
    // A genuine runtime error offers Restart, which remounts the frame.
    const error = new MessageEvent("message", { data: { type: "studium-visual", event: "error", message: "boom" } });
    Object.defineProperty(error, "source", { value: frame.contentWindow });
    window.dispatchEvent(error);
    expect(await screen.findByText("This visual stopped with an error.")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Restart" }));
    await waitFor(() => expect(document.querySelector("iframe")).not.toBeNull());
  });
});
