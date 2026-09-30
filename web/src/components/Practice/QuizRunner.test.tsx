import type { JobView, PracticeAttemptResult, PracticeQuiz } from "@studium/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { practiceApi, usePracticeAttempt } from "@/api/practice";
import { parseResponse, QuizRunner } from "./QuizRunner";

let jobs: JobView[] = [];
vi.mock("@/api/queries", () => ({ useJobs: () => ({ data: jobs }) }));
vi.mock("@/components/Reader/MarkdownView", () => ({
  MarkdownView: ({ content }: { content: string }) => <p>{content}</p>,
}));
const quiz: PracticeQuiz = {
  id: "quiz-12345678",
  title: "Recall",
  createdAt: "2026-10-01",
  questions: [
    {
      id: "q-12345678",
      type: "mcq",
      options: ["A", "B", "C", "D"],
      prompt: "Choose a vector",
      note: "notes/01-vectors.md",
      anchor: "Vectors",
      topic: "vectors",
      difficulty: 1,
    },
  ],
};
const grade: PracticeAttemptResult = {
  id: "a-12345678",
  questionId: "q-12345678",
  score: 0,
  verdict: "wrong",
  feedback: "Try again",
  answer: "B",
  explanation: "Only shown after submission",
  note: "notes/01-vectors.md",
  anchor: "Vectors",
  topic: "vectors",
};
function Wrapper({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>{children}</MemoryRouter>
    </QueryClientProvider>
  );
}
beforeEach(() => {
  jobs = [];
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("uses keyboard selection and submission, shows feedback only afterward, and retries wrong questions", async () => {
  const answer = vi.spyOn(practiceApi, "answer").mockResolvedValue(grade);
  render(<QuizRunner set="algebra" quiz={quiz} onClose={() => {}} />, { wrapper: Wrapper });
  const heading = screen.getByRole("heading", { name: /vectors/ });
  expect(document.activeElement).toBe(heading);
  expect(screen.queryByText(grade.explanation)).toBeNull();
  fireEvent.keyDown(heading, { key: "1" });
  fireEvent.keyDown(heading, { key: "Enter" });
  await screen.findByText(grade.explanation);
  expect(answer).toHaveBeenCalledExactlyOnceWith("algebra", quiz.id, quiz.questions[0]?.id, "A");
  const finish = screen.getByRole("button", { name: "Finish quiz" });
  await waitFor(() => expect(document.activeElement).toBe(finish));
  fireEvent.keyDown(finish, { key: "n" });
  expect(screen.getByText("Quiz complete")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Retry wrong ones" }));
  expect(screen.queryByText(grade.explanation)).toBeNull();
  expect(screen.getByText("Question 1 of 1")).toBeTruthy();
});
it("validates finite numeric input, keeps multi answers as options, and trims text", () => {
  const base = quiz.questions[0];
  if (!base) throw new Error("missing fixture");
  expect(parseResponse({ ...base, type: "numeric" }, "", [])).toBeNull();
  expect(parseResponse({ ...base, type: "numeric" }, "1e309", [])).toBeNull();
  expect(parseResponse({ ...base, type: "numeric" }, "-0.5", [])).toBe(-0.5);
  expect(parseResponse({ ...base, type: "multi" }, "", ["A", "B"])).toEqual(["A", "B"]);
  expect(parseResponse({ ...base, type: "cloze" }, " vector ", [])).toBe("vector");
});
it("keeps a background grade pending and receives the finished result without resubmitting", async () => {
  const action = vi.fn().mockResolvedValue({ jobId: "job-1" });
  const { result, rerender } = renderHook(() => usePracticeAttempt("algebra"), { wrapper: Wrapper });
  await act(async () => {
    await result.current.submit(action);
  });
  expect(result.current.busy).toBe(true);
  expect(result.current.result).toBeNull();
  expect(result.current.viewJob).toBeTypeOf("function");
  await act(async () => {
    await result.current.submit(action);
  });
  expect(action).toHaveBeenCalledTimes(1);
  jobs = [
    {
      id: "job-1",
      kind: "grade-answer",
      status: "done",
      set: "algebra",
      title: "Grading",
      progress: "",
      startedAt: null,
      finishedAt: null,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
      billing: "metered",
      result: { practiceResult: grade },
    },
  ];
  rerender();
  await waitFor(() => expect(result.current.result).toEqual(grade));
  expect(result.current.busy).toBe(false);
});

it("reports a failed background grade and allows a fresh submission", async () => {
  const action = vi.fn().mockResolvedValue({ jobId: "failed-grade" });
  const { result, rerender } = renderHook(() => usePracticeAttempt("algebra"), { wrapper: Wrapper });
  await act(async () => {
    await Promise.all([result.current.submit(action), result.current.submit(action)]);
  });
  expect(action).toHaveBeenCalledTimes(1);
  jobs = [
    {
      id: "failed-grade",
      kind: "grade-answer",
      status: "failed",
      set: "algebra",
      title: "Grading",
      progress: "",
      startedAt: null,
      finishedAt: null,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
      billing: "metered",
      error: "Grader unavailable",
    },
  ];
  rerender();
  await waitFor(() => expect(result.current.error).toBe("Grader unavailable"));
  expect(result.current.busy).toBe(false);
  await act(async () => {
    await result.current.submit(async () => grade);
  });
  expect(result.current.result).toEqual(grade);
});
