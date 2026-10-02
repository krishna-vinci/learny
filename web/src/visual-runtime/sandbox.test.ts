import { expect, it } from "vitest";
import { SKETCH_SANDBOX, sketchCsp, sketchDocument, visualMessage } from "./sandbox";

const manifest = {
  p5: "p5.012345abcdef.js",
  d3: "d3.012345abcdef.js",
  three: "three.012345abcdef.js",
  "studium-runtime": "studium-runtime.012345abcdef.js",
};
it("builds the exact first-document CSP and scripts-only sandbox", () => {
  expect(sketchCsp("https://studium.test")).toBe(
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' https://studium.test/visual-runtime/; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'">`,
  );
  expect(SKETCH_SANDBOX).toBe("allow-scripts");
});
it("injects exactly declared libraries and rejects unknown headers and manifest paths", () => {
  const html = '<script type="application/json" id="studium-visual">{"libs":["p5"],"poster":"x.svg"}</script>';
  const doc = sketchDocument(html, "https://studium.test", manifest);
  expect(doc.startsWith(sketchCsp("https://studium.test"))).toBe(true);
  expect(doc).toContain("/p5.012345abcdef.js");
  expect(doc).toContain("/studium-runtime.012345abcdef.js");
  expect(doc).not.toContain("/d3.");
  expect(doc).not.toContain("/three.");
  expect(() => sketchDocument(html.replace("p5", "fetch"), "https://studium.test", manifest)).toThrow();
  expect(() => sketchDocument(html, "https://studium.test", { ...manifest, p5: "../private.js" })).toThrow();
});
it("ignores foreign sources and malformed events", () => {
  const source = window;
  const event = (data: unknown, origin: Window | null = source) => ({ data, source: origin }) as MessageEvent;
  expect(visualMessage(event({ type: "studium-visual", event: "ready" }), source)).toEqual({ event: "ready" });
  for (const data of [
    null,
    {},
    { type: "studium-visual", event: "scene", scene: -1 },
    { type: "studium-visual", event: "error", message: 42 },
    { type: "studium-visual", event: "navigate" },
  ])
    expect(visualMessage(event(data), source)).toBeNull();
  expect(visualMessage(event({ type: "studium-visual", event: "ready" }, null), source)).toBeNull();
});
