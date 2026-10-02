import { z } from "zod";
export const SketchHeaderSchema = z
  .object({
    libs: z
      .array(z.enum(["p5", "d3", "three"]))
      .max(3)
      .default([]),
    story: z.boolean().default(false),
    aspect: z
      .string()
      .regex(/^\d{1,2}:\d{1,2}$/)
      .default("16:10"),
    poster: z
      .string()
      .regex(/^(?!.*(?:\.\.|\\|:|\?|#))[^/].*\.svg$/)
      .optional(),
    posters: z
      .array(
        z
          .object({
            src: z.string().regex(/^(?!.*(?:\.\.|\\|:|\?|#))[^/].*\.svg$/),
            narration: z.string().min(1).max(500),
          })
          .strict(),
      )
      .min(1)
      .max(100)
      .optional(),
  })
  .strict();
export function parseSketchHeader(html: string) {
  const tag =
    /<script\b(?=[^>]*\bid\s*=\s*["']studium-visual["'])(?=[^>]*\btype\s*=\s*["']application\/json["'])[^>]*>([\s\S]*?)<\/script\s*>/i.exec(
      html,
    );
  if (!tag) throw new Error("Sketch needs an application/json studium-visual header");
  return SketchHeaderSchema.parse(JSON.parse(tag[1] ?? ""));
}
