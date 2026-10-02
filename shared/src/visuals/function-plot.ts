import { z } from "zod";
import { base, number, range, text } from "./common.js";
import { compileExpression, variableName } from "./expression.js";
export const FunctionPlotSchema = z
  .object({
    ...base,
    type: z.literal("function-plot"),
    x: range,
    y: range,
    xLabel: text,
    yLabel: text,
    curves: z
      .array(z.object({ expression: text, label: text }).strict())
      .min(1)
      .max(8),
    params: z
      .array(
        z
          .object({
            name: z.string().regex(variableName),
            min: number,
            max: number,
            value: number,
            step: number.positive().optional(),
          })
          .strict()
          .refine((p) => p.max > p.min && p.value >= p.min && p.value <= p.max, "Parameter outside range"),
      )
      .max(12)
      .default([]),
    points: z
      .array(z.object({ x: number, y: number, label: text }).strict())
      .max(20)
      .default([]),
  })
  .strict()
  .superRefine((s, c) => {
    try {
      if (new Set(s.params.map((p) => p.name)).size !== s.params.length || s.params.some((p) => p.name === "x"))
        throw new Error("Duplicate parameter");
      for (const curve of s.curves) compileExpression(curve.expression, ["x", ...s.params.map((p) => p.name)]);
    } catch (e) {
      c.addIssue({ code: "custom", message: String(e) });
    }
  });
export type FunctionPlotSpec = z.infer<typeof FunctionPlotSchema>;

import { line } from "d3";
import { color, node, type VisualState } from "./common.js";
import { axes, scene } from "./scene.js";
export function layout(spec: FunctionPlotSpec, state: VisualState = {}) {
  const { x, y, nodes } = axes(spec.x, spec.y, spec.xLabel, spec.yLabel);
  const params: Record<string, number> = {};
  for (const p of spec.params)
    params[p.name] = Math.max(
      p.min,
      Math.min(p.max, typeof state[p.name] === "number" ? Number(state[p.name]) : p.value),
    );
  spec.curves.forEach((curve, i) => {
    const f = compileExpression(curve.expression, ["x", ...Object.keys(params)]);
    const points = Array.from({ length: 241 }, (_, n) => {
      const v = spec.x[0] + (n * (spec.x[1] - spec.x[0])) / 240;
      return [x(v), y(f({ ...params, x: v }))] as [number, number];
    });
    const d = line<[number, number]>().defined((p) => Number.isFinite(p[1]) && p[1] >= 32 && p[1] <= 336)(points) ?? "";
    nodes.push(
      node("path", { d, fill: "none", stroke: color(i), "stroke-width": 3 }),
      node("text", { x: 80, y: 48 + i * 24, fill: color(i) }, curve.label),
    );
  });
  for (const p of spec.points)
    nodes.push(
      node("circle", { cx: x(p.x), cy: y(p.y), r: 5, fill: color(1) }),
      node("text", { x: x(p.x) + 8, y: y(p.y) - 8 }, p.label),
    );
  return scene(nodes, spec.caption);
}
