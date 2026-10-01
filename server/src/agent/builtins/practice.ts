import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import {
  type AnswerGrade,
  AnswerGradeSchema,
  type StoredProblem,
  StoredProblemSchema,
  type StoredQuestion,
  StoredQuestionSchema,
  type TeachBackGrade,
  TeachBackGradeSchema,
} from "@studium/shared";
import { Type } from "typebox";
import { practiceId } from "../../practice/store.js";

const nullableText = () => Type.Optional(Type.Union([Type.String(), Type.Null()]));
const nullableStrings = () => Type.Optional(Type.Union([Type.Array(Type.String()), Type.Null()]));
const metadata = {
  note: Type.String(),
  anchor: Type.String(),
  topic: Type.String(),
  difficulty: Type.Integer({ minimum: 1, maximum: 3 }),
  src: nullableText(),
};
const answer = Type.Union([
  Type.String(),
  Type.Array(Type.String()),
  Type.Object({ value: Type.Number(), tolerance: Type.Number({ minimum: 0 }) }),
]);
function cleaned(params: Record<string, unknown>) {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value != null && (typeof value !== "string" || value.trim() !== "")),
  );
}
function ok(summary: string) {
  return { content: [{ type: "text" as const, text: summary }], details: { isError: false, summary } };
}
function fail(error: unknown) {
  const summary = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text" as const, text: `Error: ${summary}` }], details: { isError: true, summary } };
}

export function addPracticeQuestionTool(opts: {
  maxAdds: number;
  onAdd: (question: StoredQuestion) => Promise<void>;
}): ToolDefinition {
  let added = 0;
  return defineTool({
    name: "add_practice_question",
    label: "Add practice question",
    description:
      "Add a validated question to this run's quiz. The server generates its id and stores private answers separately from the API projection.",
    parameters: Type.Object({
      ...metadata,
      type: Type.Union([
        Type.Literal("mcq"),
        Type.Literal("multi"),
        Type.Literal("short"),
        Type.Literal("numeric"),
        Type.Literal("cloze"),
      ]),
      prompt: Type.String(),
      options: nullableStrings(),
      unit: nullableText(),
      answer,
      explanation: Type.String(),
    }),
    executionMode: "sequential" as const,
    async execute(_id, params) {
      try {
        if (added >= opts.maxAdds) throw new Error("question count limit reached");
        const question = StoredQuestionSchema.parse({ ...cleaned(params), id: practiceId("q") });
        await opts.onAdd(question);
        added += 1;
        return ok(`added ${question.id}`);
      } catch (error) {
        return fail(error);
      }
    },
  });
}
export function addProblemTool(opts: {
  maxAdds: number;
  onAdd: (problem: StoredProblem) => Promise<void>;
}): ToolDefinition {
  let added = 0;
  return defineTool({
    name: "add_problem",
    label: "Add problem",
    description:
      "Add a source-grounded problem, private hints, and worked solution to this run's problem set; the server generates its id.",
    parameters: Type.Object({
      ...metadata,
      statement: Type.String(),
      hints: Type.Array(Type.String(), { minItems: 1, maxItems: 8 }),
      answerType: Type.Union([Type.Literal("numeric"), Type.Literal("expression"), Type.Literal("short")]),
      answer,
      solution: Type.String(),
    }),
    executionMode: "sequential" as const,
    async execute(_id, params) {
      try {
        if (added >= opts.maxAdds) throw new Error("problem count limit reached");
        const problem = StoredProblemSchema.parse({ ...cleaned(params), id: practiceId("p") });
        await opts.onAdd(problem);
        added += 1;
        return ok(`added ${problem.id}`);
      } catch (error) {
        return fail(error);
      }
    },
  });
}
export function submitGradeTool(opts: {
  teachback: boolean;
  onGrade: (grade: AnswerGrade | TeachBackGrade) => void;
}): ToolDefinition {
  let submitted = false;
  return defineTool({
    name: "submit_grade",
    label: "Submit grade",
    description:
      "Return the structured assessment. Teach-back requires accuracy, completeness, clarity (0–4), misconceptions with citations, and missing ideas.",
    parameters: Type.Object({
      score: Type.Number({ minimum: 0, maximum: 1 }),
      feedback: Type.String(),
      gap: nullableText(),
      accuracy: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: 4 }), Type.Null()])),
      completeness: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: 4 }), Type.Null()])),
      clarity: Type.Optional(Type.Union([Type.Integer({ minimum: 0, maximum: 4 }), Type.Null()])),
      misconceptions: Type.Optional(
        Type.Union([
          Type.Array(Type.Object({ claim: Type.String(), correction: Type.String(), citation: Type.String() })),
          Type.Null(),
        ]),
      ),
      missing: nullableStrings(),
    }),
    executionMode: "sequential" as const,
    async execute(_id, params) {
      try {
        if (submitted) throw new Error("grade already submitted");
        const grade = (opts.teachback ? TeachBackGradeSchema : AnswerGradeSchema).parse(cleaned(params));
        opts.onGrade(grade);
        submitted = true;
        return ok("grade submitted");
      } catch (error) {
        return fail(error);
      }
    },
  });
}
