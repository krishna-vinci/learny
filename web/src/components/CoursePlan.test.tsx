import type { CourseChapter, CourseView } from "@studium/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { queryKeys } from "@/api/queries";
import { CoursePlan, nextDrafts, prerequisiteReason } from "./CoursePlan";

vi.mock("@/api/client", () => ({
  api: { sets: { course: vi.fn() }, jobs: { create: vi.fn().mockResolvedValue({ jobId: "new" }) } },
}));
vi.mock("@/components/FirstUseHint", () => ({
  FirstUseHint: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
const chapter = (order: number, state: CourseChapter["state"], prerequisites = "none"): CourseChapter => ({
  order,
  title: `Chapter ${order}`,
  scope: `Learner scope ${order}`,
  state,
  prerequisites,
});
const chapters: CourseChapter[] = [
  { ...chapter(1, "checked"), path: "notes/01-one.md" },
  { ...chapter(2, "drafted"), path: "notes/02-two.md" },
  { ...chapter(3, "drafting"), jobId: "working" },
  chapter(4, "planned", "01"),
  chapter(5, "planned", "03"),
  chapter(6, "planned", "04"),
  chapter(7, "planned"),
  chapter(8, "planned", "02"),
];
function setup(rows = chapters) {
  const course: CourseView = { subject: "history", chapters: rows };
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  queryClient.setQueryData(queryKeys.course("history"), course);
  vi.mocked(api.sets.course).mockResolvedValue(course);
  const onReplan = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <CoursePlan set="history" jobs={[]} onReplan={onReplan} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return { onReplan };
}
it("renders course states and links, collapses after six rows, and opens re-planning", () => {
  const { onReplan } = setup();
  for (const state of ["Checked", "Drafted", "Drafting", "Planned"])
    expect(screen.getAllByText(state).length).toBeGreaterThan(0);
  expect(screen.getByRole("link", { name: "Chapter 1" }).getAttribute("href")).toBe("/s/history/n/01-one.md");
  expect(screen.queryByText("Chapter 7")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Show all 8" }));
  expect(screen.getByText("Chapter 8")).toBeTruthy();
  expect(screen.getByText("Tip: you can also ask the tutor to draft the next chapters.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Re-plan" }));
  expect(onReplan).toHaveBeenCalledOnce();
});
it("sends the chapter's title and learner scope for Draft and gates prerequisites", async () => {
  setup();
  expect((screen.getByRole("button", { name: "Draft Chapter 5" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Draft 03 first.")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Draft Chapter 4" }));
  await waitFor(() =>
    expect(api.jobs.create).toHaveBeenCalledWith({
      kind: "draft-chapter",
      set: "history",
      title: "Chapter 4",
      brief: "Learner scope 4",
    }),
  );
});
it("Draft next 3 selects only the next eligible planned chapters in course order", async () => {
  expect(nextDrafts([...chapters].reverse()).map((c) => c.order)).toEqual([4, 7, 8]);
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Draft next 3" }));
  await waitFor(() => expect(api.jobs.create).toHaveBeenCalledTimes(3));
  expect(vi.mocked(api.jobs.create).mock.calls.map(([request]) => ("title" in request ? request.title : null))).toEqual(
    ["Chapter 4", "Chapter 7", "Chapter 8"],
  );
});
it("disables the batch with a reason when no chapter is ready and blocks malformed prerequisites", () => {
  for (const prerequisite of ["99", "05", "01, 01", "read 01"]) {
    expect(prerequisiteReason(chapter(5, "planned", prerequisite), chapters)).toContain("Re-plan");
  }
  setup([chapter(1, "planned", "02")]);
  expect((screen.getByRole("button", { name: "Draft next 3" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Re-plan to clarify this chapter's prerequisites.")).toBeTruthy();
});
