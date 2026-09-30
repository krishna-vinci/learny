import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { PracticeSummary, TeachBackGrade, TeachBackResult } from "@studium/shared";
import { Hono } from "hono";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { EventHub } from "../events.js";
import { JobRunner } from "../jobs/runner.js";
import type { PracticeGrader } from "../practice/grade.js";
import { seedPractice } from "../practice/practice.test-helper.js";
import type { PracticeStore } from "../practice/store.js";
import { ensureRepo, log } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { practiceRoutes } from "./practice.js";

let root: string;
let app: Hono;
let store: PracticeStore;
let grader: ReturnType<typeof vi.fn<PracticeGrader>>;
let deps: { root: string; locks: FileLocks; hub: EventHub };
const base = "/api/sets/algebra/practice";
const post = (url: string, body: unknown, env?: unknown) =>
  app.request(
    `${base}${url}`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
    env,
  );
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "practice-routes-"));
  await fs.writeFile(path.join(root, "init.md"), "init");
  await ensureRepo(root);
  deps = { root, locks: new FileLocks(), hub: new EventHub() };
  store = await seedPractice(deps);
  grader = vi.fn<PracticeGrader>().mockResolvedValue({ score: 0.5, feedback: "Missing direction", gap: "direction" });
  app = new Hono();
  app.route("/api/sets/:set/practice", practiceRoutes({ ...deps, grader }));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it("never leaks private fields through quiz/problem/summary GETs before submission", async () => {
  for (const url of ["", "/quizzes/quiz-12345678", "/problems/01-vectors.md"]) {
    const response = await app.request(`${base}${url}`);
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toMatch(/PRIVATE|"answer"|"explanation"|"solution"|"hints"/);
  }
  expect((await post("/quizzes/quiz-12345678/answer", { questionId: "q-00000001", response: "A" })).status).toBe(200);
  expect(await (await app.request(`${base}/quizzes/quiz-12345678`)).text()).not.toMatch(
    /PRIVATE|"answer"|"explanation"/,
  );
});
it("grades all deterministic quiz types, logs only submitted questions, and returns their explanation", async () => {
  for (const [questionId, response, expected] of [
    ["q-00000001", "B", "wrong"],
    ["q-00000002", ["A"], "partial"],
    ["q-00000003", 4.05, "right"],
    ["q-00000004", "  inner PRODUCT ", "right"],
  ] as const) {
    const res = await post("/quizzes/quiz-12345678/answer", { questionId, response });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ verdict: expected, explanation: "PRIVATE EXPLANATION", questionId });
  }
  expect(grader).not.toHaveBeenCalled();
  expect(await store.logs()).toHaveLength(4);
  expect((await store.readWeakSpots())[0]?.attempts).toBe(4);
  expect((await post("/quizzes/quiz-12345678/answer", { questionId: "q-00000003", response: "" })).status).toBe(400);
  expect((await post("/quizzes/quiz-12345678/answer", { questionId: "q-ffffffff", response: "A" })).status).toBe(404);
});
it("uses a stubbed grader for short answers and nonnumeric problem attempts", async () => {
  const quiz = await post("/quizzes/quiz-12345678/answer", { questionId: "q-00000005", response: "Learner text" });
  expect(quiz.status).toBe(200);
  expect(await quiz.json()).toMatchObject({ score: 0.5, verdict: "partial" });
  const problem = await post("/problems/01-vectors.md/p-00000002/attempt", { response: "v + w" });
  expect(problem.status).toBe(200);
  expect(await problem.json()).toMatchObject({ score: 0.5, solution: "PRIVATE SOLUTION" });
  expect(grader).toHaveBeenCalledTimes(2);
  expect(grader.mock.calls[0]?.[0]).toMatchObject({
    kind: "answer",
    note: "notes/01-vectors.md",
    response: "Learner text",
  });
  expect((await log(root, { limit: 1 }))[0]?.author).toBe("grader");
});
it("reveals progressive hints and caps later answers at partial after a solution reveal", async () => {
  expect(await (await post("/problems/01-vectors.md/p-00000001/hint", {})).json()).toMatchObject({
    hint: "First hint",
    remaining: 1,
  });
  expect(await (await post("/problems/01-vectors.md/p-00000001/reveal", {})).json()).toMatchObject({
    revealed: true,
    score: 0.5,
    solution: "PRIVATE SOLUTION",
  });
  expect(await (await post("/problems/01-vectors.md/p-00000001/attempt", { response: 4 })).json()).toMatchObject({
    score: 0.5,
    verdict: "partial",
    revealed: true,
  });
  const logs = await store.logs();
  expect(logs).toHaveLength(2);
  expect(logs.every((l) => l.score <= 0.5)).toBe(true);
  expect(grader).not.toHaveBeenCalled();
});
it("saves the full teachback rubric and derives weak spots from each gap", async () => {
  const grade: TeachBackGrade = {
    accuracy: 2,
    completeness: 1,
    clarity: 3,
    score: 0.4,
    feedback: "Review span",
    gap: "Incomplete",
    misconceptions: [
      { claim: "Vectors are scalars", correction: "Vectors have direction", citation: "[^src:lib-vectors]" },
    ],
    missing: ["span"],
  };
  grader.mockResolvedValue(grade);
  const res = await post("/teachback", { note: "notes/01-vectors.md", topic: "Vectors", text: "Vectors are scalars" });
  expect(res.status).toBe(200);
  const result = (await res.json()) as TeachBackResult;
  expect(result).toMatchObject({ accuracy: 2, completeness: 1, clarity: 3, score: 0.4, missing: ["span"] });
  expect(await fs.readFile(path.join(root, `algebra/practice/teachback/${result.id}.md`), "utf8")).toContain(
    "Vectors are scalars",
  );
  expect((await store.readWeakSpots()).map((s) => s.topic)).toEqual(["span", "vectors", "vectors are scalars"]);
  expect((await store.logs()).filter((l) => l.kind === "teachback")).toHaveLength(1);
  expect(((await (await app.request(base)).json()) as PracticeSummary).teachbacks).toHaveLength(1);
  expect((await post("/teachback", { note: "notes/01-vectors.md", text: "a".repeat(8001) })).status).toBe(400);
});
it("aborts a slow inline grade and queues a fallback without saving an unsubmitted result", async () => {
  const jobs = new JobRunner({ ...deps, maxParallel: 1 });
  const enqueue = vi.spyOn(jobs, "enqueue");
  grader.mockImplementation(
    (_request, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }),
      ),
  );
  app = new Hono();
  app.route("/api/sets/:set/practice", practiceRoutes({ ...deps, grader, jobs, gradingTimeoutMs: 5 }));
  const result = await post("/quizzes/quiz-12345678/answer", { questionId: "q-00000005", response: "slow response" });
  expect(result.status).toBe(202);
  expect(await result.json()).toMatchObject({ jobId: expect.any(String) });
  expect(enqueue).toHaveBeenCalledWith(
    "grade-answer",
    expect.objectContaining({ response: "slow response" }),
    expect.objectContaining({ set: "algebra" }),
  );
  expect(await store.logs()).toEqual([]);
});
it("blocks model routes for AI-disabled accounts, while allowing deterministic work", async () => {
  const env = { practiceAiEnabled: false };
  for (const [url, body] of [
    ["/quizzes/quiz-12345678/answer", { questionId: "q-00000005", response: "text" }],
    ["/problems/01-vectors.md/p-00000002/attempt", { response: "text" }],
    ["/teachback", { note: "notes/01-vectors.md", text: "text" }],
  ] as const)
    expect((await post(url, body, env)).status).toBe(403);
  expect((await post("/quizzes/quiz-12345678/answer", { questionId: "q-00000003", response: 4 }, env)).status).toBe(
    200,
  );
  expect((await post("/problems/01-vectors.md/p-00000001/reveal", {}, env)).status).toBe(200);
  expect(grader).not.toHaveBeenCalled();
});
it("confines API note paths and handles a missing set", async () => {
  expect((await post("/teachback", { note: "../private.md", text: "text" })).status).toBe(400);
  expect((await app.request("/api/sets/missing/practice")).status).toBe(404);
  expect((await post("/weak-spots/rebuild", {})).status).toBe(200);
});

it("protects answers from raw file and history APIs, including symlink aliases", async () => {
  app = createApp(deps);
  const sha = (await log(root, { limit: 1 }))[0]?.sha;
  await fs.symlink(
    path.join(root, "algebra/practice/quizzes/quiz-12345678.json"),
    path.join(root, "algebra/notes/alias.md"),
  );
  for (const path of ["practice/quizzes/quiz-12345678.json", "practice/problems/01-vectors.md", "notes/alias.md"]) {
    const response = await app.request(`/api/sets/algebra/file?path=${encodeURIComponent(path)}`);
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("PRIVATE");
  }
  for (const path of [undefined, "practice", "practice/problems", ".", "*"]) {
    const response = await app.request(
      `/api/sets/algebra/diff?sha=${sha}${path === undefined ? "" : `&path=${encodeURIComponent(path)}`}`,
    );
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("PRIVATE");
  }
  expect((await app.request(`/api/sets/algebra/diff?sha=${sha}&path=notes/01-vectors.md`)).status).toBe(200);
});
