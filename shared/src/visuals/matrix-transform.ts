import { z } from "zod";
import { base, number } from "./common.js";

const row = z.array(number.min(-100).max(100));
export const MatrixSchema = z
  .array(row)
  .refine(
    (m) => (m.length === 2 || m.length === 3) && m.every((r) => r.length === m.length),
    "Expected square 2×2 or 3×3 matrix",
  );
export const MatrixTransformSchema = z
  .object({
    ...base,
    type: z.literal("matrix-transform"),
    matrix: MatrixSchema,
    svd: z.object({ vT: MatrixSchema, sigma: MatrixSchema, u: MatrixSchema }).strict().optional(),
  })
  .strict();
export type MatrixTransformSpec = z.infer<typeof MatrixTransformSchema>;

import { line } from "d3";
import { color, node, type VisualState } from "./common.js";
import { axes, scene } from "./scene.js";
export function multiply(a: number[][], b: number[][]) {
  return a.map((row) => b[0]?.map((_, j) => row.reduce((sum, v, k) => sum + v * (b[k]?.[j] ?? 0), 0)) ?? []);
}
export function layout(spec: MatrixTransformSpec, state: VisualState = {}) {
  const { x, y, nodes } = axes([-4, 4], [(-304 / 544) * 4, (304 / 544) * 4], "x (units)", "y (units)");
  const progress = Math.max(0, Math.min(1, typeof state.progress === "number" ? state.progress : 1));
  let target = spec.matrix;
  let start = [
    [1, 0],
    [0, 1],
  ];
  if (spec.svd) {
    const stage = Math.max(0, Math.min(2, Math.floor(Number(state.stage ?? 0))));
    start = stage === 0 ? start : stage === 1 ? spec.svd.vT : multiply(spec.svd.sigma, spec.svd.vT);
    target =
      stage === 0
        ? spec.svd.vT
        : stage === 1
          ? multiply(spec.svd.sigma, spec.svd.vT)
          : multiply(spec.svd.u, multiply(spec.svd.sigma, spec.svd.vT));
  }
  const a = (target[0]?.[0] ?? 1) * progress + (start[0]?.[0] ?? 1) * (1 - progress),
    b = (target[0]?.[1] ?? 0) * progress + (start[0]?.[1] ?? 0) * (1 - progress),
    c = (target[1]?.[0] ?? 0) * progress + (start[1]?.[0] ?? 0) * (1 - progress),
    d = (target[1]?.[1] ?? 1) * progress + (start[1]?.[1] ?? 1) * (1 - progress);
  const transform = (v: [number, number]): [number, number] => [x(a * v[0] + b * v[1]), y(c * v[0] + d * v[1])];
  const visible = ([px, py]: [number, number]) => px >= 64 && px <= 608 && py >= 32 && py <= 336;
  const path = (points: [number, number][], stroke: string, width: number) => {
    let mapped = points.map(transform);
    // Clip each grid segment parametrically; discarding outside endpoints would hide crossing lines.
    if (mapped.length === 2) {
      const [p, q] = mapped as [[number, number], [number, number]];
      const dx = q[0] - p[0],
        dy = q[1] - p[1];
      let start = 0,
        end = 1;
      for (const [direction, distance] of [
        [-dx, p[0] - 64],
        [dx, 608 - p[0]],
        [-dy, p[1] - 32],
        [dy, 336 - p[1]],
      ] as const) {
        if (direction === 0 && distance < 0) {
          start = 1;
          end = 0;
          break;
        }
        if (direction < 0) start = Math.max(start, distance / direction);
        if (direction > 0) end = Math.min(end, distance / direction);
      }
      mapped =
        start > end
          ? []
          : [
              [p[0] + start * dx, p[1] + start * dy],
              [p[0] + end * dx, p[1] + end * dy],
            ];
    }
    return node("path", {
      d: line<[number, number]>().defined(visible)(mapped) ?? "",
      fill: "none",
      stroke,
      "stroke-width": width,
    });
  };
  for (let i = -3; i <= 3; i++)
    nodes.push(
      path(
        [
          [i, -3],
          [i, 3],
        ],
        "var(--visual-grid, #d6d3d1)",
        1,
      ),
      path(
        [
          [-3, i],
          [3, i],
        ],
        "var(--visual-grid, #d6d3d1)",
        1,
      ),
    );
  nodes.push(
    path(
      Array.from(
        { length: 65 },
        (_, i) => [Math.cos((i * Math.PI) / 32), Math.sin((i * Math.PI) / 32)] as [number, number],
      ),
      color(2),
      2,
    ),
  );
  for (const [i, v] of (
    [
      [1, 0],
      [0, 1],
    ] as [number, number][]
  ).entries()) {
    const end = transform(v);
    if (!visible(end)) continue;
    nodes.push(
      node("line", { x1: x(0), y1: y(0), x2: end[0], y2: end[1], stroke: color(i), "stroke-width": 4 }),
      node("circle", { cx: end[0], cy: end[1], r: 5, fill: color(i) }),
      node("text", { x: end[0] + 8, y: end[1] - 8, fill: color(i) }, `e${i + 1}`),
    );
  }
  if (target.length === 3) nodes.push(node("text", { x: 80, y: 48 }, "3-D matrix: z = 0, projected onto x/y"));
  return scene(nodes, spec.caption);
}
