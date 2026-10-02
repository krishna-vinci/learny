import { z } from "zod";
import { base, number, text } from "./common.js";
export function year(value: number | string): number {
  if (typeof value === "number") return value;
  const date = new Date(value);
  const start = new Date(date);
  start.setUTCMonth(0, 1);
  start.setUTCHours(0, 0, 0, 0);
  return date.getUTCFullYear() + (date.getTime() - start.getTime()) / (365.2425 * 86400000);
}
const date = z.union([number.min(-100000).max(100000), z.iso.date()]);
export const TimelineSchema = z
  .object({
    ...base,
    type: z.literal("timeline"),
    events: z
      .array(z.object({ date, title: text, description: text.optional(), category: text }).strict())
      .min(1)
      .max(200),
    eras: z
      .array(
        z
          .object({ start: date, end: date, title: text })
          .strict()
          .refine((e) => year(e.end) > year(e.start), "Era must increase"),
      )
      .max(30)
      .default([]),
  })
  .strict()
  .refine((s) => new Set(s.events.map((e) => e.category)).size <= 4, "Use at most four timeline categories");
export type TimelineSpec = z.infer<typeof TimelineSchema>;

import { scaleLinear } from "d3";
import { color, node, type VisualState } from "./common.js";
import { label, scene } from "./scene.js";
export function layout(spec: TimelineSpec, state: VisualState = {}) {
  const dates = [...spec.events.map((e) => year(e.date)), ...spec.eras.flatMap((e) => [year(e.start), year(e.end)])];
  const min = Math.min(...dates),
    max = Math.max(...dates);
  const zoom = Math.max(1, Math.min(10, Number(state.zoom ?? 1))),
    center = Number(state.center ?? (min + max) / 2),
    span = (Math.max(1, max - min) * 1.2) / zoom;
  const x = scaleLinear([center - span / 2, center + span / 2], [56, 608]);
  const categories = [...new Set(spec.events.map((e) => e.category))];
  const nodes = [node("line", { x1: 56, x2: 608, y1: 320, y2: 320, stroke: "var(--visual-fg, #292524)" })];
  for (const tick of x.ticks(6))
    nodes.push(
      node("line", { x1: x(tick), x2: x(tick), y1: 314, y2: 326, stroke: "var(--visual-fg, #292524)" }),
      node("text", { x: x(tick), y: 348, "text-anchor": "middle" }, tick < 0 ? `${Math.abs(tick)} BCE` : String(tick)),
    );
  for (const era of spec.eras) {
    const start = Math.max(56, x(year(era.start))),
      end = Math.min(608, x(year(era.end)));
    if (end <= start) continue;
    nodes.push(
      node("rect", {
        x: start,
        y: 40,
        width: end - start,
        height: 28,
        fill: color(4),
        opacity: 0.25,
      }),
      label(era.title, start + 4, 60, Math.max(26, end - start - 8)),
    );
  }
  spec.events.forEach((e, i) => {
    const position = x(year(e.date));
    if (position < 56 || position > 608) return;
    const y = 105 + categories.indexOf(e.category) * 48;
    nodes.push(
      node("line", { x1: position, x2: position, y1: y, y2: 320, stroke: color(categories.indexOf(e.category)) }),
      node("circle", {
        cx: position,
        cy: y,
        r: i === Number(state.selected ?? 0) ? 9 : 6,
        fill: color(categories.indexOf(e.category)),
      }),
      label(e.title, position, y - 14, 240, { "text-anchor": "middle" }),
    );
  });
  return scene(
    nodes,
    spec.events[Math.max(0, Math.min(spec.events.length - 1, Math.floor(Number(state.selected ?? 0))))]?.description ??
      spec.caption,
  );
}
