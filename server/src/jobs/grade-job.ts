import { PracticeResponseSchema } from "@studium/shared";
import { z } from "zod";
import { createPracticeGrader } from "../agent/practice-grader.js";
import { answerAndRecord } from "../practice/grade.js";
import { isSetSlug } from "../tree/read.js";
import type { DraftJobDeps } from "./draft-job.js";
import type { JobHandler } from "./runner.js";

const GradeJobSchema = z.object({
  set: z.string().refine(isSetSlug),
  response: PracticeResponseSchema,
  target: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("quiz"),
      quizId: z.string().regex(/^quiz-[0-9a-f]{8}$/),
      questionId: z.string().regex(/^q-[0-9a-f]{8}$/),
    }),
    z.object({
      kind: z.literal("problem"),
      file: z.string().regex(/^[0-9]{2,}-[a-z0-9][a-z0-9-]*\.md$/),
      questionId: z.string().regex(/^p-[0-9a-f]{8}$/),
    }),
  ]),
});
export function createGradeJob(deps: DraftJobDeps): JobHandler {
  return async (raw, ctx) => {
    const input = GradeJobSchema.parse(raw);
    ctx.progress("Grading answer");
    const practiceResult = await answerAndRecord(
      deps,
      input.set,
      input.target,
      input.response,
      ctx.signal,
      createPracticeGrader(deps, input.set, ctx),
    );
    ctx.progress("Answer graded");
    return { practiceResult };
  };
}
