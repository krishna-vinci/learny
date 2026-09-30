import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { ensureRepo, log } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { SET, seedPractice } from "./practice.test-helper.js";
import { PracticeStore } from "./store.js";

let root: string;
let store: PracticeStore;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "practice-store-"));
  await fs.writeFile(path.join(root, "init.md"), "init");
  await ensureRepo(root);
  store = await seedPractice({ root, locks: new FileLocks() });
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it("stores JSON quizzes and Markdown problems with confined paths and Examiner authorship", async () => {
  expect((await log(root, { limit: 1 }))[0]?.author).toBe("examiner");
  const quiz = await store.quizView("quiz-12345678");
  const problems = await store.problemsView("01-vectors.md");
  expect(JSON.stringify([quiz, problems])).not.toMatch(/PRIVATE|"answer"|"explanation"|"solution"|"hints"/);
  expect(await fs.readFile(path.join(root, `${SET}/practice/problems/01-vectors.md`), "utf8")).toContain("```json");
  await expect(store.readQuiz("../escape")).rejects.toThrow();
  await expect(store.readProblems("../../PLAN.md")).rejects.toThrow();
  await expect(store.checkNote("../outside.md")).rejects.toThrow();
  await fs.symlink(path.join(root, "init.md"), path.join(root, `${SET}/practice/quizzes/quiz-aaaaaaaa.json`));
  await expect(store.readQuiz("quiz-aaaaaaaa")).rejects.toThrow("aliases");
  await fs.symlink(os.tmpdir(), path.join(root, `${SET}/practice/teachback`));
  expect(() => store.confined(`${SET}/practice/teachback/escape.md`)).toThrow("escapes study root");
});
it("serializes concurrent attempts, keeps the log append-only, and fully rebuilds a missing cache", async () => {
  await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      store.record({
        id: `attempt-${index}`,
        kind: "quiz",
        createdAt: `2026-10-01T12:00:0${index}.000Z`,
        topic: " Vectors ",
        note: "notes/01-vectors.md",
        score: index % 2,
        gap: "Gap",
      }),
    ),
  );
  const original = await fs.readFile(path.join(root, `${SET}/log/practice.jsonl`), "utf8");
  expect(original.trim().split("\n")).toHaveLength(4);
  expect((await store.readWeakSpots())[0]?.attempts).toBe(4);
  await store.record({
    id: "final",
    kind: "quiz",
    createdAt: "2026-10-01T12:00:05.000Z",
    topic: "vectors",
    note: "notes/01-vectors.md",
    score: 1,
    gap: "",
  });
  expect(await fs.readFile(path.join(root, `${SET}/log/practice.jsonl`), "utf8")).toMatch(
    new RegExp(`^${original.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`),
  );
  const spots = await store.readWeakSpots();
  await fs.unlink(path.join(root, `${SET}/practice/weak-spots.json`));
  expect(await store.rebuild()).toEqual(spots);
  // Restoring identical tracked content correctly leaves the previous commit intact.
  expect((await log(root, { limit: 1 }))[0]?.author).toBe("user");
});
it("reveals hints one at a time and persists progress", async () => {
  expect(await store.revealHint("01-vectors.md", "p-00000001")).toMatchObject({ hint: "First hint", remaining: 1 });
  const next = new PracticeStore(store.deps, SET);
  expect(await next.revealHint("01-vectors.md", "p-00000001")).toMatchObject({ hint: "Second hint", remaining: 0 });
  expect(await next.revealHint("01-vectors.md", "p-00000001")).toMatchObject({ hint: null });
  expect((await log(root, { limit: 1 }))[0]?.author).toBe("user");
});
