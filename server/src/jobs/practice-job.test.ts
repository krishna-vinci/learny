import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it } from "vitest";
import { createModelRuntime } from "../agent/models.js";
import { EventHub } from "../events.js";
import { McpManager } from "../mcp/bridge.js";
import { PracticeStore } from "../practice/store.js";
import { ensureRepo, log } from "../tree/git.js";
import { initStudyTree } from "../tree/init.js";
import { FileLocks } from "../tree/lock.js";
import { createGradeJob } from "./grade-job.js";
import { createPracticeJob, parseMakeProblemsInput, parseMakeQuizInput } from "./practice-job.js";
import { jobsRoutes } from "./routes.js";
import { JobRunner } from "./runner.js";

let root: string;
let agentDir: string;
let previous: string | undefined;
const note = "notes/03-svd.md";
const set = "linear-algebra";
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "practice-job-"));
  agentDir = await fs.mkdtemp(path.join(os.tmpdir(), "practice-agent-"));
  previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  await fs.cp(fileURLToPath(new URL("../../../examples/sample-set", import.meta.url)), root, { recursive: true });
  await initStudyTree(root);
  await ensureRepo(root);
});
afterEach(async () => {
  if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
  else process.env.PI_CODING_AGENT_DIR = previous;
  await Promise.all([fs.rm(root, { recursive: true, force: true }), fs.rm(agentDir, { recursive: true, force: true })]);
});
const ctx = () => ({ signal: new AbortController().signal, progress: () => {}, addUsage: () => {} });
it("generates quizzes and problems with the faux provider, with server-generated ids", async () => {
  const runtime = await createModelRuntime();
  const faux = fauxProvider({ provider: "faux", models: [{ id: "echo" }] });
  runtime.registerNativeProvider(faux.provider);
  const deps = { root, locks: new FileLocks(), hub: new EventHub(), runtime, mcp: new McpManager([]) };
  const base = { note, anchor: "SVD", topic: "SVD", difficulty: 2, src: "lib-strang-la" };
  faux.setResponses([
    ...Array.from({ length: 5 }, (_, i) =>
      fauxAssistantMessage(
        fauxToolCall(
          "add_practice_question",
          {
            ...base,
            type: "mcq",
            prompt: `Question ${i}`,
            options: ["A", "B", "C", "D"],
            answer: "A",
            explanation: "Because",
            unit: null,
          },
          { id: `quiz-${i}` },
        ),
        { stopReason: "toolUse" },
      ),
    ),
    fauxAssistantMessage(fauxText("done")),
  ]);
  const quiz = await createPracticeJob(deps, "make-quiz")({ set, notes: [note], count: 5, types: ["mcq"] }, ctx());
  expect(quiz?.quizId).toMatch(/^quiz-[0-9a-f]{8}$/);
  expect(quiz?.commitSha).toMatch(/^[0-9a-f]{40}$/);
  const store = new PracticeStore(deps, set);
  if (!quiz?.quizId) throw new Error("missing generated quiz");
  expect((await store.readQuiz(quiz.quizId)).questions).toHaveLength(5);
  faux.setResponses([
    ...Array.from({ length: 3 }, (_, i) =>
      fauxAssistantMessage(
        fauxToolCall(
          "add_problem",
          {
            ...base,
            statement: `Problem ${i}`,
            hints: ["Hint"],
            answerType: "numeric",
            answer: { value: 2, tolerance: 0 },
            solution: "Worked solution",
          },
          { id: `problem-${i}` },
        ),
        { stopReason: "toolUse" },
      ),
    ),
    fauxAssistantMessage(fauxText("done")),
  ]);
  const problems = await createPracticeJob(deps, "make-problems")({ set, note, count: 3 }, ctx());
  expect(problems?.problemFile).toBe("03-svd.md");
  expect((await store.readProblems("03-svd.md")).problems).toHaveLength(3);
  expect((await log(root, { limit: 1 }))[0]?.author).toBe("examiner");
  // Repeat generation replaces the same per-note file under its lock.
  faux.setResponses([
    ...Array.from({ length: 3 }, (_, i) =>
      fauxAssistantMessage(
        fauxToolCall(
          "add_problem",
          {
            ...base,
            statement: `New ${i}`,
            hints: ["Hint"],
            answerType: "short",
            answer: "Reference",
            solution: "Reasoning",
          },
          { id: `new-${i}` },
        ),
        { stopReason: "toolUse" },
      ),
    ),
    fauxAssistantMessage(fauxText("done")),
  ]);
  await createPracticeJob(deps, "make-problems")({ set, note, count: 3 }, ctx());
  expect((await store.readProblems("03-svd.md")).problems[0]?.statement).toBe("New 0");
});
it("runs the background Grader with a faux structured submit_grade tool call", async () => {
  const runtime = await createModelRuntime();
  const faux = fauxProvider({ provider: "faux", models: [{ id: "echo" }] });
  runtime.registerNativeProvider(faux.provider);
  const deps = { root, locks: new FileLocks(), hub: new EventHub(), runtime, mcp: new McpManager([]) };
  const store = new PracticeStore(deps, set);
  await store.saveProblems("03-svd.md", {
    note,
    createdAt: new Date().toISOString(),
    problems: Array.from({ length: 3 }, (_, i) => ({
      id: `p-0000000${i}`,
      note,
      topic: "SVD",
      anchor: "SVD",
      statement: "Explain",
      difficulty: 2 as const,
      hints: ["Hint"],
      hintsRevealed: 0,
      answerType: "short" as const,
      answer: "Reference",
      solution: "Solution",
    })),
  });
  faux.setResponses([
    fauxAssistantMessage(
      fauxToolCall(
        "submit_grade",
        { score: 0.5, feedback: "Missing idea", gap: "span", accuracy: null, misconceptions: null },
        { id: "grade" },
      ),
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage(fauxText("done")),
  ]);
  const result = await createGradeJob(deps)(
    { set, target: { kind: "problem", file: "03-svd.md", questionId: "p-00000000" }, response: "My explanation" },
    ctx(),
  );
  expect(result?.practiceResult).toMatchObject({ score: 0.5, verdict: "partial" });
  expect(await store.logs()).toHaveLength(1);
});
it("validates count/types/paths at enqueue and rejects incomplete generation", async () => {
  expect(() => parseMakeQuizInput({ set, count: 4 })).toThrow();
  expect(() => parseMakeQuizInput({ set, count: 5, types: ["other"] })).toThrow();
  expect(() => parseMakeProblemsInput({ set, note: "../private.md", count: 3 })).toThrow();
  expect(() => parseMakeProblemsInput({ set, note, count: 9 })).toThrow();
  const runtime = await createModelRuntime();
  const faux = fauxProvider({ provider: "faux", models: [{ id: "echo" }] });
  runtime.registerNativeProvider(faux.provider);
  faux.setResponses([fauxAssistantMessage(fauxText("done without tools"))]);
  const deps = { root, locks: new FileLocks(), hub: new EventHub(), runtime, mcp: new McpManager([]) };
  await expect(createPracticeJob(deps, "make-quiz")({ set, count: 5 }, ctx())).rejects.toThrow("0 of 5");
  const jobs = new JobRunner({ root, hub: deps.hub, maxParallel: 1 });
  const app = new Hono();
  app.route("/api/jobs", jobsRoutes({ root, runner: jobs }));
  const res = await app.request("/api/jobs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "make-problems", set, note: "notes/99-missing.md", count: 3 }),
  });
  expect(res.status).toBe(404);
});
