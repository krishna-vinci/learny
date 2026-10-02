import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import SetHomePage from "./SetHomePage";

let planning = false;
vi.mock("@/api/queries", () => ({
  useSets: () => ({ data: [{ slug: "history", title: "History" }] }),
  useNotes: () => ({ data: [{ path: "notes/01-city.md", title: "A city", order: 1 }], isLoading: false }),
  useLibrary: () => ({ data: [] }),
  useToday: () => ({ data: { doNext: [] } }),
  useJobs: () => ({
    data: planning ? [{ id: "plan", kind: "plan-set", set: "history", status: "running", title: "Plan" }] : [],
  }),
  useNoteFile: () => ({ data: { body: "## Goal\nKnow the past", frontmatter: {} } }),
  useBook: () => ({ data: { lastModified: null }, isLoading: false }),
}));
vi.mock("@/components/CoursePlan", () => ({
  CoursePlan: () => <section aria-label="Course plan">Course plan</section>,
}));
vi.mock("@/components/Library/AddSourceSheet", () => ({
  AddSourceSheet: ({ open }: { open: boolean }) => (open ? <p>Add source form</p> : null),
}));
vi.mock("@/components/NewChapterSheet", () => ({ NewChapterSheet: () => <p>Chapter form</p> }));
vi.mock("@/components/NewNoteDialog", () => ({
  NewNoteDialog: ({ open }: { open: boolean }) => (open ? <p>Note form</p> : null),
}));
vi.mock("@/components/PlanSetSheet", () => ({ PlanSetSheet: () => <p>Plan form</p> }));
afterEach(() => {
  cleanup();
  planning = false;
});
function setup() {
  render(
    <MemoryRouter initialEntries={["/s/history"]}>
      <Routes>
        <Route path="/s/:set" element={<SetHomePage />} />
      </Routes>
    </MemoryRouter>,
  );
}
it("orders toolbar, notes, book, course plan and next step with promoted actions and visible download", () => {
  setup();
  const ordered = [
    screen.getByRole("toolbar"),
    screen.getByText("Notes"),
    screen.getByRole("region", { name: "Book" }),
    screen.getByRole("region", { name: "Course plan" }),
    screen.getByLabelText("Next step"),
  ] as const;
  ordered.slice(1).forEach((element, index) => {
    const previous = ordered[index];
    if (!previous) throw new Error("Missing preceding section");
    expect(previous.compareDocumentPosition(element) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });
  expect(screen.queryByText("More actions")).toBeNull();
  expect(screen.getByRole("button", { name: "Rebuild" })).toBeTruthy();
  expect(screen.getByRole("link", { name: /Download/ })).toBeTruthy();
  for (const [button, form] of [
    ["Add source", "Add source form"],
    ["New chapter", "Chapter form"],
    ["Write a note", "Note form"],
    ["Make a plan", "Plan form"],
  ] as const) {
    fireEvent.click(screen.getByRole("button", { name: button }));
    expect(screen.getByText(form)).toBeTruthy();
  }
});
it("keeps preparation near the top during planning and hides the next step", () => {
  planning = true;
  setup();
  const preparing = screen.getByRole("status", { name: "Plan in progress" });
  expect(
    preparing.compareDocumentPosition(screen.getByRole("toolbar")) & Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(screen.queryByLabelText("Next step")).toBeNull();
  expect(screen.getByText(/1 running in the background/)).toBeTruthy();
});
