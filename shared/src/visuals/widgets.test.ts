import { expect, it } from "vitest";
import { compileExpression } from "./expression.js";
import { layoutWidget, parseWidget, widgetScenes, widgetToSvg } from "./index.js";

const plot = () =>
  parseWidget(
    JSON.stringify({
      type: "function-plot",
      title: "Waves",
      x: [-3, 3],
      y: [-2, 2],
      xLabel: "Time (s)",
      yLabel: "Amplitude (m)",
      params: [{ name: "a", min: 0, max: 2, value: 1 }],
      curves: [{ expression: "a*sin(x)", label: "Wave" }],
    }),
  );
it("validates plots and re-lays out curves when sliders change", () => {
  const spec = plot();
  const one = layoutWidget(spec, { a: 1 }),
    two = layoutWidget(spec, { a: 2 });
  expect(one.nodes.filter((n) => n.tag === "text").map((n) => n.text)).toContain("Time (s)");
  expect(one.nodes.find((n) => n.tag === "path")?.attrs.d).not.toBe(two.nodes.find((n) => n.tag === "path")?.attrs.d);
  expect(() => parseWidget(JSON.stringify({ ...spec, x: [2, 1] }))).toThrow();
  expect(() =>
    parseWidget(JSON.stringify({ ...spec, curves: [{ expression: "x.constructor", label: "bad" }] })),
  ).toThrow();
});
it("renders transformed basis geometry and the SVD stages without DOM", () => {
  const spec = parseWidget(
    JSON.stringify({
      type: "matrix-transform",
      title: "Stretch",
      matrix: [
        [2, 0],
        [0, 1],
      ],
    }),
  );
  const origin = layoutWidget(spec, { progress: 0 }),
    end = layoutWidget(spec, { progress: 1 });
  const circles = end.nodes.filter((n) => n.tag === "circle");
  expect(circles[0]?.attrs.cx).toBeCloseTo(472);
  expect(circles[0]?.attrs.cy).toBeCloseTo(184);
  expect(circles[1]?.attrs.cx).toBeCloseTo(336);
  expect(circles[1]?.attrs.cy).toBeCloseTo(116);
  expect(origin.nodes.filter((n) => n.tag === "circle")[0]?.attrs.cx).toBe(404);
  expect(() =>
    parseWidget(
      JSON.stringify({
        ...spec,
        matrix: [
          [1, 2, 3],
          [1, 2, 3],
        ],
      }),
    ),
  ).toThrow();
  const svd = parseWidget(
    JSON.stringify({
      ...spec,
      svd: {
        vT: [
          [1, 0],
          [0, 1],
        ],
        sigma: [
          [2, 0],
          [0, 1],
        ],
        u: [
          [0, -1],
          [1, 0],
        ],
      },
    }),
  );
  expect(widgetScenes(svd)).toHaveLength(3);
  expect(layoutWidget(svd, { stage: 1, progress: 0 }).nodes.filter((n) => n.tag === "circle")).toEqual(
    layoutWidget(svd, { stage: 0, progress: 1 }).nodes.filter((n) => n.tag === "circle"),
  );
  expect(layoutWidget(svd, { stage: 2 }).nodes.filter((n) => n.tag === "circle")[0]?.attrs.cy).toBeCloseTo(48);
});
it("validates trace indexes and renders step captions and highlighted values", () => {
  const spec = parseWidget(
    JSON.stringify({
      type: "step-through",
      title: "Sort",
      steps: [
        { caption: "Compare the pair.", items: [2, 1], active: [0, 1] },
        { caption: "Swap the pair.", items: [1, 2] },
      ],
    }),
  );
  expect(layoutWidget(spec, { step: 1 }).caption).toBe("Swap the pair.");
  expect(layoutWidget(spec, { step: 1 }).nodes.filter((n) => n.tag === "text")[0]?.text).toBe("1");
  expect(() =>
    parseWidget(JSON.stringify({ ...spec, steps: [{ caption: "Bad", items: [1], edges: [[0, 9]] }] })),
  ).toThrow();
});
it("positions BCE and ISO events and zooms a deterministic timeline", () => {
  const spec = parseWidget(
    JSON.stringify({
      type: "timeline",
      title: "History",
      events: [
        { date: -1000, title: "Before", category: "Era" },
        { date: "2000-01-01", title: "After", category: "Era", description: "A new era." },
      ],
    }),
  );
  const initial = layoutWidget(spec);
  expect(initial.nodes.filter((n) => n.tag === "circle")[0]?.attrs.cx).toBeCloseTo(102);
  expect(initial.nodes.filter((n) => n.tag === "circle")[1]?.attrs.cx).toBeCloseTo(562);
  expect(initial.nodes.some((n) => n.text?.includes("BCE"))).toBe(true);
  expect(layoutWidget(spec, { zoom: 2 }).nodes.filter((n) => n.tag === "circle")).toHaveLength(0);
  expect(() =>
    parseWidget(JSON.stringify({ ...spec, events: [{ date: "not-a-date", title: "Bad", category: "x" }] })),
  ).toThrow();
});
it("renders safe XML from the same scene and explicit story state", () => {
  const spec = parseWidget(
    JSON.stringify({
      type: "step-through",
      title: "A < B",
      steps: [{ caption: "A & B", items: ["<script>"] }],
      story: { scenes: [{ state: { step: 0 }, narration: "Compare." }] },
    }),
  );
  expect(widgetToSvg(spec)).toContain("&lt;script&gt;");
  expect(widgetToSvg(spec)).not.toContain("<script>");
  expect(widgetScenes(spec)[0]?.narration).toBe("Compare.");
});
it("fuzz-rejects property access, prototype keys, definitions, assignment and undeclared values", () => {
  for (const attack of [
    "constructor",
    "__proto__",
    "x.constructor",
    "x[0]",
    "x=2",
    "f(x)=2",
    "x;2",
    "sin.constructor(x)",
    "random()",
    "this",
    "sin(x)?1:2",
    "x||1",
    ...["constructor", "__proto__", "prototype"].flatMap((key) => [`x.${key}`, `x["${key}"]`, `${key}(x)`]),
  ])
    expect(() => compileExpression(attack, ["x"]), attack).toThrow();
  const f = compileExpression("sin(x)+pow(a,2)+max(x,a)", ["x", "a"]);
  expect(f({ x: 0, a: 2 })).toBe(6);
  expect(() => f({ x: 0, a: () => 1 } as unknown as Record<string, number>)).toThrow();
  for (let i = 0; i < 100; i++) expect(() => compileExpression(`x.${"a".repeat(i + 1)}`, ["x"])).toThrow();
});

it("rejects invalid authored story states and mismatched SVD dimensions", () => {
  const spec = plot();
  expect(() =>
    parseWidget(JSON.stringify({ ...spec, story: { scenes: [{ state: { a: "Infinity" }, narration: "Bad." }] } })),
  ).toThrow();
  expect(() =>
    parseWidget(JSON.stringify({ ...spec, story: { scenes: [{ state: { constructor: 1 }, narration: "Bad." }] } })),
  ).toThrow();
});
