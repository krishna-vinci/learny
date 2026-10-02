import { z } from "zod";
import { FunctionPlotSchema, layout as plotLayout } from "./function-plot.js";
import { MatrixTransformSchema, layout as matrixLayout } from "./matrix-transform.js";
import { StepThroughSchema, layout as stepLayout } from "./step-through.js";
import { TimelineSchema, layout as timelineLayout } from "./timeline.js";
export const WidgetSchema = z
  .union([FunctionPlotSchema, MatrixTransformSchema, StepThroughSchema, TimelineSchema])
  .superRefine((spec, context) => {
    if (
      spec.type === "matrix-transform" &&
      spec.svd &&
      Object.values(spec.svd).some((m) => m.length !== spec.matrix.length)
    )
      context.addIssue({ code: "custom", message: "SVD matrices must have matching dimensions" });
    const allowed =
      spec.type === "function-plot"
        ? spec.params.map((p) => p.name)
        : spec.type === "matrix-transform"
          ? ["progress", "stage"]
          : spec.type === "step-through"
            ? ["step"]
            : ["zoom", "center", "selected"];
    for (const [i, scene] of (spec.story?.scenes ?? []).entries())
      for (const [key, value] of Object.entries(scene.state)) {
        let valid = allowed.includes(key) && typeof value === "number";
        if (typeof value === "number") {
          if (spec.type === "function-plot") {
            const p = spec.params.find((p) => p.name === key);
            valid = valid && !!p && value >= p.min && value <= p.max;
          }
          if (key === "progress") valid = valid && value >= 0 && value <= 1;
          if (key === "zoom") valid = valid && value >= 1 && value <= 10;
          if (["stage", "step", "selected"].includes(key)) {
            const max =
              key === "stage"
                ? 2
                : spec.type === "step-through"
                  ? spec.steps.length - 1
                  : spec.type === "timeline"
                    ? spec.events.length - 1
                    : 0;
            valid = valid && Number.isInteger(value) && value >= 0 && value <= max;
          }
        }
        if (!valid)
          context.addIssue({
            code: "custom",
            path: ["story", "scenes", i, "state", key],
            message: "Unknown or out-of-range numeric scene control",
          });
      }
  });
export type WidgetSpec = z.infer<typeof WidgetSchema>;
export function parseWidget(raw: string): WidgetSpec {
  if (new TextEncoder().encode(raw).length > 300 * 1024) throw new Error("Visual spec must be at most 300 KB");
  return WidgetSchema.parse(JSON.parse(raw));
}

import type { VisualState } from "./common.js";
import { sceneToSvg } from "./scene.js";
export function layoutWidget(spec: WidgetSpec, state: VisualState = {}) {
  switch (spec.type) {
    case "function-plot":
      return plotLayout(spec, state);
    case "matrix-transform":
      return matrixLayout(spec, state);
    case "step-through":
      return stepLayout(spec, state);
    case "timeline":
      return timelineLayout(spec, state);
  }
}
export function widgetToSvg(spec: WidgetSpec, state: VisualState = {}) {
  return sceneToSvg(layoutWidget(spec, state), spec.title);
}
export function widgetScenes(spec: WidgetSpec) {
  if (spec.story) return spec.story.scenes;
  if (spec.type === "step-through") return spec.steps.map((s, step) => ({ state: { step }, narration: s.caption }));
  if (spec.type === "matrix-transform" && spec.svd)
    return [
      "Rotate into principal directions (Vᵀ).",
      "Scale along those directions (Σ).",
      "Rotate into the output basis (U).",
    ].map((narration, stage) => ({ state: { stage, progress: 1 }, narration }));
  return [{ state: {}, narration: spec.caption ?? spec.title }];
}
