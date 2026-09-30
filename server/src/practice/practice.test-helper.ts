import { promises as fs } from "node:fs";
import type { StoredProblemSet, StoredQuiz } from "@studium/shared";
import { PracticeStore, type PracticeStoreDeps } from "./store.js";

export const NOTE = "notes/01-vectors.md";
export const SET = "algebra";
export function quizFixture(): StoredQuiz {
  const base = {
    note: NOTE,
    anchor: "Vectors",
    topic: "Vectors",
    difficulty: 2 as const,
    explanation: "PRIVATE EXPLANATION",
    src: "lib-vectors",
  };
  return {
    id: "quiz-12345678",
    title: "Vectors quiz",
    createdAt: "2026-10-01T12:00:00.000Z",
    questions: [
      { ...base, id: "q-00000001", type: "mcq", prompt: "Choose", options: ["A", "B", "C", "D"], answer: "A" },
      {
        ...base,
        id: "q-00000002",
        type: "multi",
        prompt: "Choose all",
        options: ["A", "B", "C", "D"],
        answer: ["A", "C"],
      },
      { ...base, id: "q-00000003", type: "numeric", prompt: "Compute", answer: { value: 4, tolerance: 0.1 } },
      { ...base, id: "q-00000004", type: "cloze", prompt: "Fill ____", answer: "Inner Product" },
      { ...base, id: "q-00000005", type: "short", prompt: "Explain", answer: "PRIVATE REFERENCE" },
    ],
  };
}
export function problemsFixture(): StoredProblemSet {
  const base = {
    note: NOTE,
    anchor: "Vectors",
    topic: "Vectors",
    difficulty: 2 as const,
    statement: "Compute",
    hints: ["First hint", "Second hint"],
    hintsRevealed: 0,
    solution: "PRIVATE SOLUTION",
  };
  return {
    note: NOTE,
    createdAt: "2026-10-01T12:00:00.000Z",
    problems: [
      { ...base, id: "p-00000001", answerType: "numeric", answer: { value: 4, tolerance: 0.1 } },
      { ...base, id: "p-00000002", answerType: "expression", answer: "PRIVATE EXPRESSION" },
      { ...base, id: "p-00000003", answerType: "short", answer: "PRIVATE REFERENCE" },
    ],
  };
}
export async function seedPractice(deps: PracticeStoreDeps): Promise<PracticeStore> {
  await fs.mkdir(`${deps.root}/${SET}/notes`, { recursive: true });
  await fs.writeFile(`${deps.root}/${SET}/PLAN.md`, "---\ntitle: Algebra\nstatus: active\n---\n");
  await fs.writeFile(`${deps.root}/${SET}/${NOTE}`, "# Vectors\nGrounded content.");
  const store = new PracticeStore(deps, SET);
  await store.saveQuiz(quizFixture());
  await store.saveProblems("01-vectors.md", problemsFixture());
  return store;
}
