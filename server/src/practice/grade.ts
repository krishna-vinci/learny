import {
  type AnswerGrade,
  AnswerGradeSchema,
  type PracticeAttemptResult,
  type PracticeLog,
  type PracticeResponse,
  type TeachBackGrade,
  TeachBackGradeSchema,
  type TeachBackResult,
} from "@studium/shared";
import { deterministicScore, verdict } from "./grading.js";
import { PracticeError, PracticeStore, type PracticeStoreDeps, practiceId } from "./store.js";

export type GradeRequest = {
  kind: "answer" | "teachback";
  note: string;
  topic: string;
  response: PracticeResponse;
  prompt: string;
  referenceAnswer?: unknown;
};
export type PracticeGrader = (request: GradeRequest, signal: AbortSignal) => Promise<AnswerGrade | TeachBackGrade>;
export type AnswerTarget =
  | { kind: "quiz"; quizId: string; questionId: string }
  | { kind: "problem"; file: string; questionId: string };

export async function answerAndRecord(
  deps: PracticeStoreDeps,
  set: string,
  target: AnswerTarget,
  response: PracticeResponse,
  signal: AbortSignal,
  grader?: PracticeGrader,
  reveal = false,
): Promise<PracticeAttemptResult> {
  const store = new PracticeStore(deps, set);
  const item =
    target.kind === "quiz"
      ? (await store.readQuiz(target.quizId)).questions.find((q) => q.id === target.questionId)
      : (await store.readProblems(target.file)).problems.find((p) => p.id === target.questionId);
  if (!item) throw new PracticeError("not_found", "question or problem not found");
  await store.checkNote(item.note);
  const deterministic = reveal ? 0.5 : deterministicScore(item, response);
  if (deterministic === undefined && !grader) throw new Error("grader is unavailable");
  const grade =
    deterministic === undefined
      ? AnswerGradeSchema.parse(
          await (grader as PracticeGrader)(
            {
              kind: "answer",
              note: item.note,
              topic: item.topic,
              response,
              prompt: "prompt" in item ? item.prompt : item.statement,
              referenceAnswer: item.answer,
            },
            signal,
          ),
        )
      : {
          score: deterministic,
          feedback: reveal
            ? "Solution revealed. Try a similar problem unaided."
            : deterministic === 1
              ? "Correct."
              : deterministic === 0.5
                ? "Partly correct."
                : "Review the explanation and try again.",
          gap: deterministic === 1 ? "" : "explanation" in item ? item.explanation : "Solution needed",
        };
  signal.throwIfAborted();
  const result: PracticeAttemptResult = {
    id: practiceId("attempt"),
    questionId: item.id,
    score: grade.score,
    verdict: verdict(grade.score),
    feedback: grade.feedback,
    answer: item.answer,
    explanation: "explanation" in item ? item.explanation : item.solution,
    note: item.note,
    anchor: item.anchor,
    topic: item.topic,
    ...(item.src === undefined ? {} : { src: item.src }),
    ...("solution" in item ? { solution: item.solution } : {}),
    ...(reveal ? { revealed: true } : {}),
  };
  const entry: PracticeLog = {
    id: result.id,
    kind: target.kind,
    createdAt: new Date().toISOString(),
    note: item.note,
    topic: item.topic,
    score: result.score,
    gap: grade.gap,
    response,
    questionId: item.id,
    result,
    ...(target.kind === "quiz" ? { quizId: target.quizId } : { problemFile: target.file }),
    ...(reveal ? { revealed: true } : {}),
  };
  await store.record(entry, reveal ? "user" : deterministic === undefined ? "grader" : "user");
  return entry.result as PracticeAttemptResult;
}

export async function teachbackAndRecord(
  deps: PracticeStoreDeps,
  set: string,
  input: { note: string; topic?: string; text: string },
  signal: AbortSignal,
  grader: PracticeGrader,
): Promise<TeachBackResult> {
  const store = new PracticeStore(deps, set);
  await store.checkNote(input.note);
  const topic = input.topic ?? input.note.slice(6, -3);
  const grade = TeachBackGradeSchema.parse(
    await grader(
      {
        kind: "teachback",
        note: input.note,
        topic,
        response: input.text,
        prompt: "Assess this explanation against the entire note using accuracy, completeness, and clarity.",
      },
      signal,
    ),
  );
  signal.throwIfAborted();
  const result: TeachBackResult = {
    id: practiceId("tb"),
    note: input.note,
    topic,
    createdAt: new Date().toISOString(),
    accuracy: grade.accuracy,
    completeness: grade.completeness,
    clarity: grade.clarity,
    misconceptions: grade.misconceptions,
    missing: grade.missing,
    score: grade.score,
    feedback: grade.feedback,
  };
  await store.record(
    {
      id: result.id,
      kind: "teachback",
      createdAt: result.createdAt,
      note: input.note,
      topic,
      score: result.score,
      gap: grade.gap,
      response: input.text,
      result,
      weaknesses: [
        ...grade.missing.map((idea) => ({ topic: idea, gap: `Missing: ${idea}`, score: 0 })),
        ...grade.misconceptions.map((m) => ({ topic: m.claim, gap: `${m.correction} ${m.citation}`, score: 0 })),
      ],
    },
    "grader",
    { result, text: input.text },
  );
  return result;
}
