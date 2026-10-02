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
  const html = '<script type="application/json" id="studium-visual">{"libs":[],"poster":"x.svg"}</script>';
  expect(() => validateAgentMedia("alpha/visuals/x.html", html)).not.toThrow();
  expect(() => validateAgentMedia("alpha/visuals/x.html", html.replace(',"poster":"x.svg"', ""))).toThrow("poster");
  expect(() => validateAgentMedia("alpha/visuals/x.svg", "<svg><script/></svg>")).toThrow("Unsafe SVG");
});
