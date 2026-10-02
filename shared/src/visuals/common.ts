import { z } from "zod";
export const text = z.string().trim().min(1).max(500);
export const number = z.number().finite();
export const range = z.tuple([number, number]).refine(([a, b]) => b > a, "Range must increase");
export const StorySchema = z
  .object({
    scenes: z
      .array(
        z.object({ state: z.record(z.string(), z.union([number, z.string(), z.boolean()])), narration: text }).strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();
export const base = { title: text, caption: text.optional(), story: StorySchema.optional() };
export type VisualState = Record<string, number | string | boolean>;
export interface SvgNode {
  tag: "g" | "line" | "path" | "circle" | "rect" | "text";
  attrs: Record<string, string | number>;
  text?: string;
  children?: SvgNode[];
}
export interface Scene {
  width: number;
  height: number;
  nodes: SvgNode[];
  caption?: string;
}
export function node(tag: SvgNode["tag"], attrs: SvgNode["attrs"], text?: string): SvgNode {
  return { tag, attrs, ...(text === undefined ? {} : { text }) };
}
export const palette = ["#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#F0E442", "#000000"];
export function color(index: number) {
  return `var(--visual-color-${index % palette.length}, ${palette[index % palette.length]})`;
}
