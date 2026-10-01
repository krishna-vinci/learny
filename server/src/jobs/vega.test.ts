import { expect, it } from "vitest";
import { chartToSvg } from "./vega.js";

const spec = {
  data: {
    values: [
      { x: "A", y: 2 },
      { x: "B", y: 4 },
    ],
  },
  mark: "bar",
  encoding: { x: { field: "x", type: "nominal" }, y: { field: "y", type: "quantitative" } },
};
it("renders inline data with the expression interpreter to a static SVG", async () => {
  const svg = await chartToSvg(JSON.stringify(spec));
  expect(svg).toContain("<svg");
  expect(svg).toContain('aria-roledescription="bar"');
});
it("rejects URL data and image marks before a loader can fetch", async () => {
  await expect(chartToSvg(JSON.stringify({ ...spec, data: { url: "https://example.org/x.json" } }))).rejects.toThrow(
    "inline",
  );
  await expect(chartToSvg(JSON.stringify({ ...spec, mark: "image" }))).rejects.toThrow("External");
});
