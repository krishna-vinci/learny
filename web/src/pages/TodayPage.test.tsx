import type { TodayView } from "@studium/shared";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useToday } from "@/api/queries";
import TodayPage from "./TodayPage";

vi.mock("@/api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/queries")>();
  return { ...actual, useToday: vi.fn() };
});

const set = {
  slug: "algebra",
  title: "Linear algebra",
  status: "active" as const,
  level: 2,
  deadline: null,
  nextAction: "Continue learning",
  daysLeft: null,
  inboxCount: 3,
  chaptersToReview: 2,
  plansToReview: 1,
  draftCards: 0,
  staleCardFiles: 0,
  runningJobs: [],
  lastStudiedAt: null,
  nextChapter: null,
  notesCount: 0,
  weakTopics: [],
  practiceDue: 0,
};

const data: TodayView = {
  sets: [set],
  doNext: [
    {
      kind: "inbox",
      reviewKind: "plan",
      set: "algebra",
      title: "Review your study plan",
      detail: "Linear algebra · 1 plan awaiting review",
      href: "/s/algebra/inbox",
    },
    {
      kind: "inbox",
      reviewKind: "chapter",
      set: "algebra",
      title: "Review chapters",
      detail: "Linear algebra · 2 chapters awaiting review",
      href: "/s/algebra/inbox",
    },
  ],
};

function renderToday(view: TodayView) {
  vi.mocked(useToday).mockReturnValue({
    data: view,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useToday>);
  render(
    <MemoryRouter>
      <TodayPage />
    </MemoryRouter>,
  );
}

describe("Today review counts", () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(cleanup);

  it("shows separate plan and chapter counts and hides zero-count links", () => {
    renderToday(data);

    expect(screen.getByText("2 chapters to review")).toBeTruthy();
    expect(screen.getByText("1 study plan to review")).toBeTruthy();
    expect(screen.getByText("Review your study plan")).toBeTruthy();
    expect(screen.getByText("Review chapters")).toBeTruthy();
    expect(screen.queryByText("0 topics due for practice →")).toBeNull();
    expect(screen.queryByText("0 new cards to check")).toBeNull();
    expect(screen.queryByText("0 chapters' cards need a refresh")).toBeNull();
  });

  it("uses a neutral count for older Today responses without the new fields", () => {
    const { chaptersToReview: _chaptersToReview, plansToReview: _plansToReview, ...legacySet } = set;
    renderToday({ ...data, sets: [legacySet] });

    expect(screen.getByText("3 items to review")).toBeTruthy();
    expect(screen.queryByText("3 chapters to review")).toBeNull();
  });
});
