import { z } from "zod";

const SetStatus = z.enum(["draft", "active", "paused", "done"]);
const NoteStatus = z.enum(["draft", "checked", "accepted"]);
const SourceType = z.enum(["book", "paper", "article", "video", "notes", "other"]);
const ParseTier = z.enum(["basic", "mineru", "firecrawl", "transcript"]);

// `<set>/PLAN.md`. Unknown keys pass through; fields are optional so a user-edited
// file still yields the parts that parse.
export const PlanFrontmatter = z.looseObject({
  title: z.string().optional(),
  status: SetStatus.optional(),
  level: z.number().int().nullable().optional(),
  deadline: z.string().nullable().optional(),
  sources: z.array(z.string()).optional(),
  next_action: z.string().nullable().optional(),
});

// `<set>/notes/NN-slug.md`.
export const NoteFrontmatter = z.looseObject({
  title: z.string().optional(),
  order: z.number().int().nullable().optional(),
  status: NoteStatus.nullable().optional(),
  sources: z.array(z.string()).optional(),
});

// `library/<src-id>/source.md`.
export const SourceFrontmatter = z.looseObject({
  id: z.string(),
  title: z.string(),
  authors: z.array(z.string()).default([]),
  type: SourceType,
  url: z.string().optional(),
  credibility: z.string(),
  parse_tier: ParseTier,
  sha256: z.string().optional(),
  added: z.string(),
});

// `_global/studium.yaml`.
export const StudiumYaml = z.looseObject({
  schema_version: z.number().int(),
});

// `_global/config.yaml`.
export const ConfigYaml = z.looseObject({
  models: z.looseObject({
    default: z.string(),
    roles: z.record(z.string(), z.string()).default({}),
  }),
  // Providers (model-string prefixes) the learner pays a flat subscription for.
  billing: z
    .looseObject({
      subscription: z.array(z.string()).default([]),
    })
    .optional(),
});

export type PlanFrontmatter = z.infer<typeof PlanFrontmatter>;
export type NoteFrontmatter = z.infer<typeof NoteFrontmatter>;
export type SourceFrontmatter = z.infer<typeof SourceFrontmatter>;
export type StudiumYaml = z.infer<typeof StudiumYaml>;
export type ConfigYaml = z.infer<typeof ConfigYaml>;
