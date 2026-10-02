import { z } from "zod";
import { base, number, text } from "./common.js";

const item = z.union([text, number]);
const step = z
  .object({
    caption: text,
    items: z.array(item).min(1).max(24),
    active: z.array(z.number().int().nonnegative()).max(24).default([]),
    edges: z
      .array(z.tuple([z.number().int().nonnegative(), z.number().int().nonnegative()]))
      .max(100)
      .default([]),
  })
  .strict()
  .refine(
    (s) => s.active.every((i) => i < s.items.length) && s.edges.every((e) => e.every((i) => i < s.items.length)),
    "Trace index outside items",
  );
export const StepThroughSchema = z
  .object({
    ...base,
    type: z.literal("step-through"),
    view: z.enum(["array", "graph", "boxes"]).default("array"),
    steps: z.array(step).min(1).max(100),
  })
  .strict()
  .refine(
    (s) => s.view === "array" || s.steps.every((step) => step.items.length <= (s.view === "boxes" ? 6 : 8)),
    "Use at most six boxes or eight graph nodes for a readable small process",
  );
export type StepThroughSpec = z.infer<typeof StepThroughSchema>;

import { color, node, type VisualState } from "./common.js";
import { label, scene } from "./scene.js";
export function layout(spec: StepThroughSpec, state: VisualState = {}) {
  const step =
    spec.steps[Math.max(0, Math.min(spec.steps.length - 1, Math.floor(Number(state.step ?? 0))))] ?? spec.steps[0];
  if (!step) throw new Error("Trace is empty");
  const positions = step.items.map((_, i) =>
    spec.view === "graph"
      ? [
          320 + 160 * Math.cos((2 * Math.PI * i) / step.items.length),
          180 + 120 * Math.sin((2 * Math.PI * i) / step.items.length),
        ]
      : spec.view === "boxes"
        ? [320, 40 + (i * 280) / step.items.length]
        : [56 + (i % 6) * 104, 70 + Math.floor(i / 6) * 72],
  );
  const nodes = step.edges.map(([a, b]) =>
    node("line", {
      x1: positions[a]?.[0] ?? 0,
      y1: positions[a]?.[1] ?? 0,
      x2: positions[b]?.[0] ?? 0,
      y2: positions[b]?.[1] ?? 0,
      stroke: color(2),
      "stroke-width": 2,
    }),
  );
  step.items.forEach((value, i) => {
    const [x = 0, y = 0] = positions[i] ?? [];
    nodes.push(
      node("rect", {
        x: x - (spec.view === "boxes" ? 260 : 42),
        y: y - 24,
        width: spec.view === "boxes" ? 520 : 84,
        height: 48,
        rx: 6,
        fill: step.active.includes(i) ? color(0) : "var(--visual-bg, #fafaf9)",
        stroke: color(0),
        "stroke-width": 2,
      }),
      label(String(value), x, y + 6, spec.view === "boxes" ? 500 : 72, {
        "text-anchor": "middle",
        fill: step.active.includes(i) ? "#fff" : "var(--visual-fg, #292524)",
      }),
    );
  });
  nodes.push(node("text", { x: 320, y: 376, "text-anchor": "middle" }, `Step ${Number(state.step ?? 0) + 1}`));
  return scene(nodes, step.caption);
}
