import { PracticeNoteSchema, QuestionTypeSchema, type StoredProblem, type StoredQuestion } from "@studium/shared";
import { z } from "zod";
import { addPracticeQuestionTool, addProblemTool } from "../agent/builtins/practice.js";
import { rethrowRoleModelError, runRole } from "../agent/run-role.js";
import { PracticeStore, practiceId } from "../practice/store.js";
import { isSetSlug, listNotes } from "../tree/read.js";
import type { DraftJobDeps } from "./draft-job.js";
import { type JobHandler, usageFromPiMessages } from "./runner.js";

const SetSchema = z.string().refine(isSetSlug, "invalid set");
const MakeQuizSchema = z.object({
  set: SetSchema,
  notes: z.array(PracticeNoteSchema).min(1).optional(),
  topics: z.array(z.string().trim().min(1)).min(1).optional(),
  count: z.number().int().min(5).max(20),
  types: z.array(QuestionTypeSchema).min(1).optional(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});
const MakeProblemsSchema = z.object({
  set: SetSchema,
  note: PracticeNoteSchema.refine(
    (note) => /^notes\/[0-9]{2,}-[a-z0-9][a-z0-9-]*\.md$/.test(note),
    "problem notes require NN-slug.md filenames",
  ),
  count: z.number().int().min(3).max(8),
});
export const parseMakeQuizInput = (input: unknown) => MakeQuizSchema.parse(input);
export const parseMakeProblemsInput = (input: unknown) => MakeProblemsSchema.parse(input);

export function createPracticeJob(deps: DraftJobDeps, kind: "make-quiz" | "make-problems"): JobHandler {
  return async (raw, ctx) => {
    const input = kind === "make-quiz" ? parseMakeQuizInput(raw) : parseMakeProblemsInput(raw);
    const store = new PracticeStore(deps, input.set);
    await store.checkSet();
    const notes =
      "note" in input
        ? [input.note]
        : (input.notes ?? (await listNotes(deps.root, input.set)).map((note) => note.path));
    if (notes.length === 0) throw new Error("no notes to practise");
    for (const note of notes) await store.checkNote(note);
    const questions: StoredQuestion[] = [];
    const problems: StoredProblem[] = [];
    const tool =
      kind === "make-quiz"
        ? addPracticeQuestionTool({
            maxAdds: input.count,
            onAdd: async (question) => {
              if (!notes.includes(question.note)) throw new Error("question must use an assigned note");
              if ("types" in input && input.types && !input.types.includes(question.type))
                throw new Error("question type not requested");
              if ("difficulty" in input && input.difficulty && question.difficulty !== input.difficulty)
                throw new Error("question difficulty not requested");
              if (
                "topics" in input &&
                input.topics &&
                !input.topics.some((topic) => topic.toLowerCase() === question.topic.toLowerCase())
              )
                throw new Error("question topic not requested");
              questions.push(question);
            },
          })
        : addProblemTool({
            maxAdds: input.count,
            onAdd: async (problem) => {
              if (problem.note !== notes[0]) throw new Error("problem must use the assigned note");
              problems.push(problem);
            },
          });
    ctx.signal.throwIfAborted();
    ctx.progress(kind === "make-quiz" ? "Generating quiz" : "Generating problems");
    const result = await runRole("examiner", {
      ...deps,
      set: input.set,
      signal: ctx.signal,
      canWrite: () => false,
      extraTools: [tool],
      task: `Load ${kind}. Read the assigned notes and their cited sources. Ground every question in the note; cite; avoid trivia; vary difficulty unless pinned; give no answers in prompt text. Add exactly ${input.count} items using ${tool.name}.\nAssigned notes: ${notes.join(", ")}\nOptions: ${JSON.stringify(input)}`,
      onModel: (provider) => ctx.useProvider?.(provider),
      onFallback: (_from, to) => ctx.progress(`Examiner model rate-limited; using ${to}`),
    }).catch(rethrowRoleModelError);
    ctx.addUsage(usageFromPiMessages(result.messages));
    ctx.signal.throwIfAborted();
    if (kind === "make-quiz") {
      if (questions.length !== input.count)
        throw new Error(`examiner produced ${questions.length} of ${input.count} questions`);
      const id = practiceId("quiz");
      const commitSha = await store.saveQuiz({
        id,
        title: "topics" in input && input.topics ? input.topics.join(", ") : "Practice quiz",
        createdAt: new Date().toISOString(),
        questions,
      });
      ctx.progress("Quiz ready");
      return { quizId: id, ...(commitSha === null ? {} : { commitSha }) };
    }
    if (problems.length !== input.count)
      throw new Error(`examiner produced ${problems.length} of ${input.count} problems`);
    const note = notes[0] as string;
    const file = note.slice("notes/".length);
    // A note has one problem set; regeneration is serialized by the file lock.
    const commitSha = await store.saveProblems(file, { note, createdAt: new Date().toISOString(), problems });
    ctx.progress("Problems ready");
    return { problemFile: file, ...(commitSha === null ? {} : { commitSha }) };
  };
}
