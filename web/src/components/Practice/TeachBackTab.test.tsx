import type { PracticeSummary, TeachBackResult } from "@studium/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { practiceApi } from "@/api/practice";
import { TeachBackTab } from "./TeachBackTab";

vi.mock("@/components/Reader/MarkdownView", () => ({
  MarkdownView: ({ content }: { content: string }) => <p>{content}</p>,
}));
const result: TeachBackResult = {
  id: "tb-12345678",
  note: "notes/01-vectors.md",
  topic: "span",
  createdAt: "2026-10-01T10:00:00Z",
  accuracy: 2,
  completeness: 3,
  clarity: 4,
  score: 0.5,
  misconceptions: [
    {
      claim: "All vectors are independent",
      correction: "Vectors may be scalar multiples",
      citation: "notes/02-matrices.md#independence",
    },
  ],
  missing: ["Linear combinations"],
  feedback: "Review independence",
};
const summary: PracticeSummary = {
  quizzes: [],
  problemSets: [],
  teachbacks: [],
  dueCount: 1,
  weakSpots: [
    {
      topic: "span",
      note: result.note,
      strength: 0.5,
      attempts: 1,
      lastSeen: result.createdAt,
      nextReview: "2026-10-01",
      intervalDays: 1,
      gap: "Review span",
    },
  ],
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("grades the chosen note and topic, renders the rubric and cited correction, and preserves text for retry", async () => {
  const grade = vi.spyOn(practiceApi, "teachback").mockResolvedValue(result);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TeachBackTab
          set="algebra"
          notes={[{ path: result.note, title: "Vectors", order: 1, status: "accepted" }]}
          summary={summary}
          topic="span"
          aiEnabled
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  const text = screen.getByLabelText("Your explanation") as HTMLTextAreaElement;
  fireEvent.change(text, { target: { value: "The span combines vectors" } });
  fireEvent.click(screen.getByRole("button", { name: "Grade teach-back" }));
  await screen.findByText("Misconceptions to revisit");
  expect(grade).toHaveBeenCalledExactlyOnceWith("algebra", {
    note: result.note,
    topic: "span",
    text: "The span combines vectors",
  });
  expect(screen.getByRole("progressbar", { name: /accuracy/i }).getAttribute("aria-valuenow")).toBe("2");
  expect(screen.getByRole("link", { name: "notes/02-matrices.md#independence" }).getAttribute("href")).toBe(
    "/s/algebra/n/02-matrices.md?q=independence",
  );
  fireEvent.click(screen.getByRole("button", { name: "Try again" }));
  expect(text.value).toBe("The span combines vectors");
  await waitFor(() => expect(document.activeElement).toBe(text));
});

it("defaults to the most recently committed note when there are no weak topics", async () => {
  const history = vi.spyOn(api.sets, "history").mockImplementation(async (_set, opts) => [
    {
      sha: "abc",
      date: opts?.path === "notes/02-matrices.md" ? "2026-10-01T10:00:00Z" : "2026-09-20T10:00:00Z",
      author: "user",
      subject: "Edit note",
    },
  ]);
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <TeachBackTab
          set="algebra"
          notes={[
            { path: "notes/01-vectors.md", title: "Vectors", order: 1, status: "accepted" },
            { path: "notes/02-matrices.md", title: "Matrices", order: 2, status: "accepted" },
          ]}
          summary={{ ...summary, weakSpots: [] }}
          aiEnabled
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  await waitFor(() => expect((screen.getByLabelText("Note") as HTMLSelectElement).value).toBe("notes/02-matrices.md"));
  expect(history).toHaveBeenCalledTimes(2);
});
