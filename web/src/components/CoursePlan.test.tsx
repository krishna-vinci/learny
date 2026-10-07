import type { CourseChapter, CourseView } from "@studium/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { ApiError, api } from "@/api/client";
import { queryKeys } from "@/api/queries";
import { toast } from "@/lib/notify";
import { CoursePlan, nextDrafts, prerequisiteReason } from "./CoursePlan";

vi.mock("@/api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/api/client")>()),
  api: {
    sets: { course: vi.fn() },
    inbox: { accept: vi.fn().mockResolvedValue({ sha: "accepted" }) },
    jobs: { create: vi.fn().mockResolvedValue({ jobId: "new" }) },
  },
}));
vi.mock("@/lib/notify", () => ({ toast: { error: vi.fn() } }));
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
function setup(rows = chapters, otherNotes: CourseView["otherNotes"] = []) {
  const course: CourseView = { subject: "history", chapters: rows, otherNotes };
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
  return { onReplan, queryClient };
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
    expect(prerequisiteReason(chapter(5, "planned", prerequisite), chapters)).toContain("Edit this chapter");
  }
  setup([chapter(1, "planned", "02")]);
  expect((screen.getByRole("button", { name: "Draft next 3" }) as HTMLButtonElement).disabled).toBe(true);
  expect(screen.getByText("Edit this chapter's prerequisites.")).toBeTruthy();
});

it("accepts checked chapters immediately and refreshes course, notes and inbox", async () => {
  const { queryClient } = setup();
  const invalidate = vi.spyOn(queryClient, "invalidateQueries");
  fireEvent.click(screen.getByRole("button", { name: "Accept Chapter 1" }));
  await waitFor(() => expect(api.inbox.accept).toHaveBeenCalledWith("history", "notes/01-one.md"));
  for (const key of [queryKeys.course("history"), queryKeys.notes("history"), queryKeys.inbox("history")]) {
    expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
  }
  expect(screen.queryByRole("button", { name: "Accept Chapter 3" })).toBeNull();
});
it("asks before accepting drafts and leaves them unchanged when cancelled", async () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Accept Chapter 2" }));
  expect(api.inbox.accept).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(api.inbox.accept).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Accept Chapter 2" }));
  fireEvent.click(await screen.findByRole("button", { name: "Accept anyway" }));
  await waitFor(() => expect(api.inbox.accept).toHaveBeenCalledWith("history", "notes/02-two.md"));
});
it("shows the server's conflict error and retains accepted links and prerequisite eligibility", async () => {
  vi.mocked(api.inbox.accept).mockRejectedValueOnce(
    new ApiError(409, "note must be draft or checked", { error: "note must be draft or checked" }),
  );
  setup([
    { ...chapter(1, "accepted"), path: "notes/01-one.md" },
    { ...chapter(2, "checked"), path: "notes/02-two.md" },
    chapter(3, "planned", "01"),
  ]);
  expect(screen.getByText("Accepted")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Chapter 1" })).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Accept Chapter 1" })).toBeNull();
  expect((screen.getByRole("button", { name: "Draft Chapter 3" }) as HTMLButtonElement).disabled).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Accept Chapter 2" }));
  await waitFor(() => expect(toast.error).toHaveBeenCalledWith("note must be draft or checked"));
});

it("shows measured evidence counts and gaps without implying verification", () => {
  setup([
    {
      ...chapter(1, "planned"),
      evidence: { covered: 1, total: 2, weakest: ["Eigenvectors"], measuredAt: "2026-10-04T00:00:00Z" },
    },
  ]);
  expect(screen.getByText("Evidence: 1/2 concepts matched")).toBeTruthy();
  expect(screen.getByText("Needs support: Eigenvectors")).toBeTruthy();
  expect(screen.getByRole("meter", { name: "Evidence for Chapter 1" }).getAttribute("value")).toBe("1");
});

it("shows made/planned visuals and chosen video metadata or an honest absence reason", () => {
  setup([
    {
      ...chapter(1, "checked"),
      media: {
        visuals: [
          { intent: "figure — Chain motion", made: true },
          { intent: "chart — Heat response", made: false },
        ],
        video: {
          intent: "Chain motion",
          status: "chosen",
          title: "Polymer lab",
          channel: "University",
          url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
          moment: "30–90s",
        },
      },
    },
    {
      ...chapter(2, "planned"),
      media: {
        visuals: [],
        video: { intent: "History tour", status: "none", reason: "No named historian at this level" },
      },
    },
  ]);
  expect(screen.getByText("Pictures in text: 1/2 made")).toBeTruthy();
  expect(screen.getByText("chart — Heat response · Planned")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Polymer lab" }).getAttribute("href")).toContain("youtube.com/watch");
  expect(screen.getByText(/University · 30–90s/)).toBeTruthy();
  expect(screen.getByText("No suitable video: No named historian at this level")).toBeTruthy();
});

it("keeps other notes linked separately while re-planned chapters remain draftable", () => {
  setup(
    [chapter(1, "planned"), chapter(2, "planned")],
    [
      { path: "notes/01-old-polymers.md", title: "Old polymers", order: 1, status: "accepted" },
      { path: "notes/02-ch-2.md", title: "Test note", order: 2, status: "draft" },
    ],
  );
  expect(screen.getByRole("region", { name: "Other notes in this set" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Old polymers" }).getAttribute("href")).toBe(
    "/s/history/n/01-old-polymers.md",
  );
  expect(screen.getByRole("link", { name: "Test note" }).getAttribute("href")).toBe("/s/history/n/02-ch-2.md");
  expect((screen.getByRole("button", { name: "Draft Chapter 1" }) as HTMLButtonElement).disabled).toBe(false);
  expect((screen.getByRole("button", { name: "Draft Chapter 2" }) as HTMLButtonElement).disabled).toBe(false);
});
