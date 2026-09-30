import type { StoredProblem, StoredQuestion, TeachBackGrade } from "@studium/shared";
import { expect, it, vi } from "vitest";
import { addPracticeQuestionTool, addProblemTool, submitGradeTool } from "./practice.js";

const metadata = { note: "notes/01-vectors.md", anchor: "Vectors", topic: "Vectors", difficulty: 2 };
it("validates question payloads, tolerates unused null/blank fields, and generates bounded ids", async () => {
  const onAdd = vi.fn<(question: StoredQuestion) => Promise<void>>().mockResolvedValue();
  const tool = addPracticeQuestionTool({ maxAdds: 1, onAdd });
  const execute = (params: Record<string, unknown>) =>
    tool.execute("call", params, undefined, undefined, undefined as never);
  const base = {
    ...metadata,
    type: "mcq",
    prompt: "Choose one",
    options: ["A", "B", "C", "D"],
    answer: "A",
    explanation: "Reason",
    src: "  ",
    unit: null,
  };
  expect((await execute({ ...base, options: ["A", "B"] })).details).toMatchObject({ isError: true });
  expect((await execute({ ...base, answer: "not an option" })).details).toMatchObject({ isError: true });
  expect((await execute(base)).details).toMatchObject({ isError: false });
  expect(onAdd.mock.calls[0]?.[0]).toMatchObject({ id: expect.stringMatching(/^q-[0-9a-f]{8}$/), type: "mcq" });
  expect(onAdd.mock.calls[0]?.[0]).not.toHaveProperty("src");
  expect((await execute(base)).details).toMatchObject({ isError: true });
  expect(onAdd).toHaveBeenCalledTimes(1);
});
it("validates private numeric problem answers and worked solutions", async () => {
  const onAdd = vi.fn<(problem: StoredProblem) => Promise<void>>().mockResolvedValue();
  const tool = addProblemTool({ maxAdds: 3, onAdd });
  const base = {
    ...metadata,
    statement: "Compute",
    hints: ["Try addition"],
    answerType: "numeric",
    answer: { value: 4, tolerance: 0 },
    solution: "Worked steps",
    src: null,
  };
  for (const patch of [{ solution: " " }, { hints: [] }, { answer: { value: 4, tolerance: -1 } }])
    expect(
      (await tool.execute("invalid", { ...base, ...patch }, undefined, undefined, undefined as never)).details,
    ).toMatchObject({ isError: true });
  expect((await tool.execute("valid", base, undefined, undefined, undefined as never)).details).toMatchObject({
    isError: false,
  });
  expect(onAdd.mock.calls[0]?.[0]).toMatchObject({ id: expect.stringMatching(/^p-[0-9a-f]{8}$/), hintsRevealed: 0 });
});
it("requires all teachback rubric fields, returns one grade, and writes no files", async () => {
  const onGrade = vi.fn();
  const tool = submitGradeTool({ teachback: true, onGrade });
  const execute = (params: Record<string, unknown>) =>
    tool.execute("grade", params, undefined, undefined, undefined as never);
  expect((await execute({ score: 0.5, feedback: "Incomplete", accuracy: 2 })).details).toMatchObject({ isError: true });
  const grade: TeachBackGrade = {
    score: 0.5,
    feedback: "Incomplete",
    gap: "",
    accuracy: 2,
    completeness: 1,
    clarity: 3,
    misconceptions: [],
    missing: ["span"],
  };
  expect((await execute({ ...grade, gap: null })).details).toMatchObject({ isError: false });
  expect(onGrade).toHaveBeenCalledWith(grade);
  expect((await execute(grade)).details).toMatchObject({ isError: true });
  expect(onGrade).toHaveBeenCalledTimes(1);
});
