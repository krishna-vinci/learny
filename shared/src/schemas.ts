import { z } from "zod";

export const PlanSubject = z.enum([
  "math",
  "science",
  "technology",
  "history",
  "finance",
  "language",
  "practical",
  "general",
]);
export type PlanSubject = z.infer<typeof PlanSubject>;

const SetStatus = z.enum(["draft", "active", "paused", "done"]);
const NoteStatus = z.enum(["draft", "checked", "accepted"]);
const SourceType = z.enum(["book", "paper", "article", "video", "notes", "other"]);
const ParseTier = z.enum(["basic", "mineru", "firecrawl", "transcript"]);

// `<set>/PLAN.md`. Unknown keys pass through; fields are optional so a user-edited
// file still yields the parts that parse.
export const PlanFrontmatter = z.looseObject({
  subject: PlanSubject.catch("general").optional(),
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
  visuals: z.object({ router: z.literal("off").default("off") }).default({ router: "off" }),
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

// Practice files carry private answers. API projections must explicitly select public fields.
const PracticeText = z.string().trim().min(1);
export const PracticeNoteSchema = z.string().regex(/^notes\/[a-z0-9][a-z0-9._-]*\.md$/);
export const QuestionTypeSchema = z.enum(["mcq", "multi", "short", "numeric", "cloze"]);
const PracticeBase = {
  note: PracticeNoteSchema,
  anchor: PracticeText,
  topic: PracticeText,
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  src: PracticeText.optional(),
};
const NumericAnswerSchema = z.object({ value: z.number().finite(), tolerance: z.number().finite().nonnegative() });
const QuestionBase = {
  ...PracticeBase,
  id: z.string().regex(/^q-[0-9a-f]{8}$/),
  prompt: PracticeText,
  explanation: PracticeText,
};
export const StoredQuestionSchema = z.discriminatedUnion("type", [
  z
    .object({ ...QuestionBase, type: z.literal("mcq"), options: z.array(PracticeText).length(4), answer: PracticeText })
    .refine(
      (q) => new Set(q.options).size === 4 && q.options.includes(q.answer),
      "answer must be one of four distinct options",
    ),
  z
    .object({
      ...QuestionBase,
      type: z.literal("multi"),
      options: z.array(PracticeText).min(2).max(8),
      answer: z.array(PracticeText).min(1),
    })
    .refine(
      (q) =>
        new Set(q.options).size === q.options.length &&
        new Set(q.answer).size === q.answer.length &&
        q.answer.every((a) => q.options.includes(a)),
      "answers must be distinct options",
    ),
  z.object({ ...QuestionBase, type: z.literal("short"), answer: PracticeText }),
  z.object({ ...QuestionBase, type: z.literal("numeric"), answer: NumericAnswerSchema, unit: PracticeText.optional() }),
  z
    .object({ ...QuestionBase, type: z.literal("cloze"), answer: PracticeText })
    .refine((q) => (q.prompt.match(/_{3,}/g) ?? []).length === 1, "cloze prompt must contain exactly one ____ blank"),
]);
export const StoredQuizSchema = z
  .object({
    id: z.string().regex(/^quiz-[0-9a-f]{8}$/),
    title: PracticeText,
    createdAt: z.iso.datetime(),
    questions: z.array(StoredQuestionSchema).min(5).max(20),
  })
  .refine((q) => new Set(q.questions.map((item) => item.id)).size === q.questions.length, "duplicate question id");
const ProblemBase = {
  ...PracticeBase,
  id: z.string().regex(/^p-[0-9a-f]{8}$/),
  statement: PracticeText,
  hints: z.array(PracticeText).min(1).max(8),
  hintsRevealed: z.number().int().min(0).max(8).default(0),
  solution: PracticeText,
};
export const StoredProblemSchema = z.discriminatedUnion("answerType", [
  z.object({ ...ProblemBase, answerType: z.literal("numeric"), answer: NumericAnswerSchema }),
  z.object({ ...ProblemBase, answerType: z.literal("expression"), answer: PracticeText }),
  z.object({ ...ProblemBase, answerType: z.literal("short"), answer: PracticeText }),
]);
export const StoredProblemSetSchema = z
  .object({
    note: PracticeNoteSchema,
    createdAt: z.iso.datetime(),
    problems: z.array(StoredProblemSchema).min(3).max(8),
  })
  .refine(
    (p) =>
      new Set(p.problems.map((item) => item.id)).size === p.problems.length &&
      p.problems.every((item) => item.note === p.note),
    "problem ids or note mismatch",
  );
export const AnswerGradeSchema = z.object({
  score: z.number().finite().min(0).max(1),
  feedback: PracticeText,
  gap: z.string().default(""),
});
export const TeachBackGradeSchema = AnswerGradeSchema.extend({
  accuracy: z.number().int().min(0).max(4),
  completeness: z.number().int().min(0).max(4),
  clarity: z.number().int().min(0).max(4),
  misconceptions: z.array(z.object({ claim: PracticeText, correction: PracticeText, citation: PracticeText })),
  missing: z.array(PracticeText),
});
export const PracticeResponseSchema = z.union([
  z.string().max(8000),
  z.number().finite(),
  z.array(z.string().max(2000)).max(8),
]);
export const WeakSpotSchema = z.object({
  topic: PracticeText,
  note: z.union([PracticeNoteSchema, z.literal("")]),
  strength: z.number().min(0).max(1),
  attempts: z.number().int().positive(),
  lastSeen: z.iso.datetime(),
  nextReview: z.iso.date(),
  intervalDays: z.union([z.literal(1), z.literal(2), z.literal(4), z.literal(8), z.literal(16)]),
  gap: z.string(),
});
export const PracticeLogSchema = z.object({
  id: PracticeText,
  kind: z.enum(["quiz", "problem", "teachback", "chat"]),
  createdAt: z.iso.datetime(),
  note: z.union([PracticeNoteSchema, z.literal("")]),
  topic: PracticeText,
  score: z.number().min(0).max(1),
  gap: z.string().default(""),
  response: PracticeResponseSchema.optional(),
  quizId: z.string().optional(),
  questionId: z.string().optional(),
  problemFile: z.string().optional(),
  revealed: z.boolean().optional(),
  chatLogLine: z.string().optional(),
  result: z.unknown().optional(),
  weaknesses: z.array(z.object({ topic: PracticeText, gap: z.string(), score: z.number().min(0).max(1) })).optional(),
});
export type StoredQuestion = z.infer<typeof StoredQuestionSchema>;
export type StoredQuiz = z.infer<typeof StoredQuizSchema>;
export type StoredProblem = z.infer<typeof StoredProblemSchema>;
export type StoredProblemSet = z.infer<typeof StoredProblemSetSchema>;
export type PracticeLog = z.infer<typeof PracticeLogSchema>;
export type AnswerGrade = z.infer<typeof AnswerGradeSchema>;
export type TeachBackGrade = z.infer<typeof TeachBackGradeSchema>;
