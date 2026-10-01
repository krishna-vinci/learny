import { PracticeNoteSchema, type PracticeResponse, PracticeResponseSchema } from "@studium/shared";
import { Hono } from "hono";
import { z } from "zod";
import { createPracticeGrader } from "../agent/practice-grader.js";
import type { DraftJobDeps } from "../jobs/draft-job.js";
import type { JobRunner } from "../jobs/runner.js";
import { type AnswerTarget, answerAndRecord, type PracticeGrader, teachbackAndRecord } from "../practice/grade.js";
import { deterministicScore } from "../practice/grading.js";
import { PracticeError, PracticeStore, type PracticeStoreDeps } from "../practice/store.js";
import { PathError } from "../tree/paths.js";

export interface PracticeRoutesDeps extends PracticeStoreDeps {
  jobs?: JobRunner;
  agent?: DraftJobDeps;
  grader?: PracticeGrader;
  gradingTimeoutMs?: number;
}
const AnswerBody = z.object({ questionId: z.string().regex(/^q-[0-9a-f]{8}$/), response: PracticeResponseSchema });
const AttemptBody = z.object({ response: PracticeResponseSchema });
const TeachbackBody = z.object({
  note: PracticeNoteSchema,
  topic: z.string().trim().min(1).max(200).optional(),
  text: z.string().trim().min(1).max(8000),
});

/** The top-level account gate passes this flag; client headers cannot override it. */
type PracticeEnv = { Bindings: { practiceAiEnabled?: boolean } };
export function practiceRoutes(deps: PracticeRoutesDeps): Hono<PracticeEnv> {
  const app = new Hono<PracticeEnv>();
  app.onError((error, c) => {
    const status =
      error instanceof PracticeError && error.code === "not_found"
        ? 404
        : error instanceof z.ZodError ||
            error instanceof PracticeError ||
            error instanceof PathError ||
            error instanceof SyntaxError
          ? 400
          : 500;
    return c.json({ error: status === 500 ? "Practice request failed" : error.message }, status);
  });
  app.use("*", async (c, next) => {
    await new PracticeStore(deps, c.req.param("set") ?? "").checkSet();
    await next();
  });
  const graderFor = (set: string) => deps.grader ?? (deps.agent ? createPracticeGrader(deps.agent, set) : undefined);
  const storeFor = (set: string) => new PracticeStore(deps, set);

  async function answer(set: string, target: AnswerTarget, response: PracticeResponse, aiEnabled: boolean) {
    const store = storeFor(set);
    const item =
      target.kind === "quiz"
        ? (await store.readQuiz(target.quizId)).questions.find((q) => q.id === target.questionId)
        : (await store.readProblems(target.file)).problems.find((p) => p.id === target.questionId);
    if (!item) throw new PracticeError("not_found", "question or problem not found");
    let score: number | undefined;
    try {
      score = deterministicScore(item, response);
    } catch (error) {
      throw new PracticeError("invalid", (error as Error).message);
    }
    if (score === undefined && !aiEnabled) return { disabled: true } as const;
    const controller = new AbortController();
    if (score !== undefined) return { result: await answerAndRecord(deps, set, target, response, controller.signal) };
    const grader = graderFor(set);
    if (!grader) throw new Error("grader is unavailable");
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const pending = grader(
        {
          kind: "answer",
          note: item.note,
          topic: item.topic,
          response,
          prompt: "prompt" in item ? item.prompt : item.statement,
          referenceAnswer: item.answer,
        },
        controller.signal,
      );
      const result = await Promise.race([
        pending,
        new Promise<null>((resolve) => {
          timer = setTimeout(() => {
            resolve(null);
            controller.abort();
          }, deps.gradingTimeoutMs ?? 60_000);
        }),
      ]);
      if (result !== null) {
        if (timer !== undefined) clearTimeout(timer);
        return { result: await answerAndRecord(deps, set, target, response, controller.signal, async () => result) };
      }
      if (!deps.jobs) throw new Error("background grading is unavailable");
      const job = deps.jobs.enqueue("grade-answer", { set, target, response }, { set, title: `Grade: ${item.topic}` });
      return { jobId: job.id };
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  app.get("/", async (c) => c.json(await storeFor(c.req.param("set") as string).summary()));
  app.get("/quizzes/:id", async (c) =>
    c.json(await storeFor(c.req.param("set") as string).quizView(c.req.param("id"))),
  );
  app.post("/quizzes/:id/answer", async (c) => {
    const body = AnswerBody.parse(await c.req.json());
    const outcome = await answer(
      c.req.param("set") as string,
      { kind: "quiz", quizId: c.req.param("id"), questionId: body.questionId },
      body.response,
      c.env?.practiceAiEnabled !== false,
    );
    if ("disabled" in outcome) return c.json({ error: "AI features are disabled for this account" }, 403);
    return "jobId" in outcome ? c.json({ jobId: outcome.jobId }, 202) : c.json(outcome.result);
  });
  app.get("/problems/:file", async (c) =>
    c.json(await storeFor(c.req.param("set") as string).problemsView(c.req.param("file"))),
  );
  app.post("/problems/:file/:id/hint", async (c) =>
    c.json(await storeFor(c.req.param("set") as string).revealHint(c.req.param("file"), c.req.param("id"))),
  );
  app.post("/problems/:file/:id/attempt", async (c) => {
    const body = AttemptBody.parse(await c.req.json());
    const outcome = await answer(
      c.req.param("set") as string,
      { kind: "problem", file: c.req.param("file"), questionId: c.req.param("id") },
      body.response,
      c.env?.practiceAiEnabled !== false,
    );
    if ("disabled" in outcome) return c.json({ error: "AI features are disabled for this account" }, 403);
    return "jobId" in outcome ? c.json({ jobId: outcome.jobId }, 202) : c.json(outcome.result);
  });
  app.post("/problems/:file/:id/reveal", async (c) =>
    c.json(
      await answerAndRecord(
        deps,
        c.req.param("set") as string,
        { kind: "problem", file: c.req.param("file"), questionId: c.req.param("id") },
        "",
        new AbortController().signal,
        undefined,
        true,
      ),
    ),
  );
  app.post("/teachback", async (c) => {
    if (c.env?.practiceAiEnabled === false) return c.json({ error: "AI features are disabled for this account" }, 403);
    const body = TeachbackBody.parse(await c.req.json());
    const set = c.req.param("set") as string;
    const grader = graderFor(set);
    if (!grader) throw new Error("grader is unavailable");
    return c.json(await teachbackAndRecord(deps, set, body, c.req.raw.signal, grader));
  });
  app.get("/weak-spots", async (c) => c.json(await storeFor(c.req.param("set") as string).readWeakSpots()));
  app.post("/weak-spots/rebuild", async (c) => c.json(await storeFor(c.req.param("set") as string).rebuild()));
  return app;
}
