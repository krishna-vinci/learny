import { expect, it } from "vitest";
import { validateAgentMedia } from "./media.js";

it("validates widget JSON with actionable schema errors and caps visuals", () => {
  expect(() =>
    validateAgentMedia(
      "alpha/visuals/x.json",
      JSON.stringify({ type: "step-through", title: "Sort", steps: [{ caption: "Start", items: [1, 2] }] }),
    ),
  ).not.toThrow();
  expect(() => validateAgentMedia("alpha/visuals/x.json", '{"type":"function-plot"}')).toThrow();
  expect(() => validateAgentMedia("alpha/visuals/x.json", " ".repeat(300 * 1024 + 1))).toThrow("300 KB");
});
it("requires static sketch posters and keeps SVG safety", () => {
  const html =
    '<script type="application/json" id="studium-visual">{"libs":[],"poster":"x.svg"}</script><script>studium.mount({draw:()=>{}});</script>';
  expect(() => validateAgentMedia("alpha/visuals/x.html", html)).not.toThrow();
  expect(() => validateAgentMedia("alpha/visuals/x.html", html.replace(',"poster":"x.svg"', ""))).toThrow("poster");
  expect(() => validateAgentMedia("alpha/visuals/x.svg", "<svg><script/></svg>")).toThrow("Unsafe SVG");
});

const header = '<script type="application/json" id="studium-visual">{"libs":[],"poster":"x.svg"}</script>';
const mounted = `${header}<svg viewBox="0 0 360 280"></svg><script>studium.mount({draw:()=>{}});</script>`;

it.each([
  ["missing header", mounted.replace(header, ""), "Header"],
  ["malformed header", mounted.replace('"libs":[]', '"libs":oops'), "Header"],
  ["invalid header library", mounted.replace('"libs":[]', '"libs":["jquery"]'), "Header libs"],
  ["missing poster", mounted.replace(',"poster":"x.svg"', ""), "Poster"],
  ["story without posters", mounted.replace('"libs":[]', '"story":true,"libs":[]'), "Story posters"],
  ["no mount", mounted.replace("studium.mount({draw:()=>{}});", ""), "Mount"],
  ["p5 undeclared", mounted.replace("studium.mount", "new p5(()=>{});studium.mount"), "Library p5"],
  ["d3 undeclared", mounted.replace("studium.mount", "d3.scaleLinear();studium.mount"), "Library d3"],
  ["three undeclared", mounted.replace("studium.mount", "new THREE.Scene();studium.mount"), "Library three"],
  ["fetch", mounted.replace("studium.mount", 'fetch("x");studium.mount'), "Network fetch"],
  ["xhr", mounted.replace("studium.mount", "new XMLHttpRequest();studium.mount"), "Network XMLHttpRequest"],
  ["websocket", mounted.replace("studium.mount", 'new WebSocket("x");studium.mount'), "Network WebSocket"],
  ["import", mounted.replace("studium.mount", 'import("x");studium.mount'), "Network dynamic import"],
  ["script source", `${mounted}<script src="x.js"></script>`, "Network script"],
  ["SVG without viewBox", mounted.replace('viewBox="0 0 360 280"', ""), "SVG"],
  ["created SVG without viewBox", `${mounted}<script>document.createElementNS('ns','svg');</script>`, "setAttribute"],
])("rejects %s with a precise corrective sentence", (_name, html, message) => {
  expect(() => validateAgentMedia("alpha/visuals/x.html", html)).toThrow(message);
});

it("warns for unused libraries and theme fields, ignores code in comments/strings, and accepts fallbacks", async () => {
  const { lintVisualHtml } = await import("./visual-lint.js");
  const warnings = lintVisualHtml(
    mounted.replace('"libs":[]', '"libs":["d3"]').replace("studium.mount", "const fg=theme.fg;studium.mount"),
  ).warnings;
  expect(warnings).toEqual([expect.stringContaining("Library d3"), expect.stringContaining('theme.fg ?? "#292524"')]);
  const safe = mounted.replace(
    "studium.mount",
    '/* fetch("x"); new p5(); */ const text="d3 theme.fg";const fg=theme.fg ?? "#292524";const bg=theme?.bg || "white";studium.mount',
  );
  expect(lintVisualHtml(safe)).toEqual({ errors: [], warnings: [] });
  // Legacy artifacts retain their existing validation contract.
  expect(() => validateAgentMedia("alpha/artifacts/x.html", '<script>fetch("x")</script>')).not.toThrow();
});

it.each([
  ['{"type":"function-plot","title":42}', "title:", '"Stretch a vector"'],
  ['{"type":"matrix-transform","title":"Stretch","matrix":[[2,0,1],[0,1]]}', "matrix:", "2×2"],
  [
    '{"type":"step-through","title":"Sort","steps":[{"caption":"Compare","items":[1,2],"active":[9]}]}',
    "steps[0]",
    "existing item",
  ],
  [
    '{"type":"timeline","title":"Dates","events":[{"date":"bad","title":"Date","category":"City"}]}',
    "events[0].date:",
    "1591",
  ],
])("turns widget schema issues into field paths and examples: %s", (raw, field, example) => {
  let error = "";
  try {
    validateAgentMedia("alpha/visuals/x.json", raw);
  } catch (e) {
    error = (e as Error).message;
  }
  expect(error).toContain(field);
  expect(error).toContain(example);
  expect(error).not.toContain('"code":');
  expect(error).not.toContain("Invalid input: expected literal");
});
it("gives JSON/type corrections and validates responsive posters", () => {
  expect(() => validateAgentMedia("alpha/visuals/x.json", "{bad")).toThrow("double-quoted");
  expect(() => validateAgentMedia("alpha/visuals/x.json", '{"type":"invented"}')).toThrow('"step-through"');
  expect(() => validateAgentMedia("alpha/visuals/x.svg", "<svg/>")).toThrow("viewBox");
  expect(() => validateAgentMedia("alpha/visuals/x.svg", '<svg viewBox="0 0 -1 10"/>')).toThrow("positive");
  expect(() => validateAgentMedia("alpha/visuals/x.svg", '<svg viewBox="0 0 360 280"/>')).not.toThrow();
});
