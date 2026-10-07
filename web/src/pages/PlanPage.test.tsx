import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import PlanPage from "./PlanPage";

let otherNotes: unknown[] = [];
let planBody = "## Goal\nLearn linear algebra for ML.\n\n## Scope\nIn: vectors, matrices.";
let chapters: unknown[] = [
  { order: 1, title: "Vectors", scope: "Dot products and norms.", prerequisites: "none", state: "accepted" },
  { order: 2, title: "Matrices", scope: "Elimination and rank.", prerequisites: "01", state: "planned" },
];

vi.mock("@/api/queries", () => ({
  useSets: () => ({
    data: [{ slug: "linear-algebra", title: "Linear algebra", status: "active", level: 2, deadline: "2026-12-01" }],
  }),
  useNoteFile: () => ({ data: { body: planBody, frontmatter: { subject: "math" } }, isLoading: false }),
  useCourse: () => ({ data: { subject: "math", chapters, otherNotes }, isLoading: false }),
  useSetSources: () => ({ data: [{ id: "lib-strang", title: "Introduction to Linear Algebra" }], isLoading: false }),
}));
vi.mock("@/components/Reader/MarkdownView", () => ({
  MarkdownView: ({ content }: { content: string }) => <div data-testid="plan-body">{content}</div>,
}));
vi.mock("@/components/NoteEditor/NoteEditor", () => ({
  NoteEditor: ({ path }: { path: string }) => <p>Editing {path}</p>,
}));
vi.mock("@/components/PlanSetSheet", () => ({ PlanSetSheet: () => <p>Plan form</p> }));

afterEach(() => {
  cleanup();
  otherNotes = [];
  planBody = "## Goal\nLearn linear algebra for ML.\n\n## Scope\nIn: vectors, matrices.";
  chapters = [
    { order: 1, title: "Vectors", scope: "Dot products and norms.", prerequisites: "none", state: "accepted" },
    { order: 2, title: "Matrices", scope: "Elimination and rank.", prerequisites: "01", state: "planned" },
  ];
});

function setup() {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={["/s/linear-algebra/plan"]}>
        <Routes>
          <Route path="/s/:set/plan" element={<PlanPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("renders header facts, the plan body, sources and chapters", () => {
  setup();
  const facts = screen.getByTestId("plan-facts");
  expect(facts.textContent).toContain("Level 2");
  expect(facts.textContent).toContain("Math");
  expect(facts.textContent).toContain("Active");

  expect(screen.getByTestId("plan-body").textContent).toContain("Learn linear algebra for ML.");

  const sourceLink = screen.getByRole("link", { name: "Introduction to Linear Algebra" });
  expect(sourceLink.getAttribute("href")).toBe("/library/lib-strang");

  expect(screen.getByText("Vectors")).toBeTruthy();
  expect(screen.getByText("Dot products and norms.")).toBeTruthy();
  expect(screen.getByText("Prerequisites: 01")).toBeTruthy();
  expect(screen.getByText("Accepted")).toBeTruthy();
  expect(screen.getByText("Planned")).toBeTruthy();
});

it("shows the empty state with a Plan with agent button when PLAN.md has no body", () => {
  planBody = "";
  chapters = [];
  setup();
  expect(screen.getByText("No plan yet")).toBeTruthy();
  expect(screen.getByRole("button", { name: /Plan with agent/ })).toBeTruthy();
  expect(screen.queryByTestId("plan-body")).toBeNull();
});

it("shows each chapter's planned media and no-video reason on the Plan page", () => {
  chapters = [
    {
      order: 1,
      title: "Vectors",
      scope: "",
      prerequisites: "none",
      state: "planned",
      media: {
        visuals: [{ intent: "diagram — Addition", made: false }],
        video: { intent: "Addition", status: "none", reason: "No suitable named educator found" },
      },
    },
  ];
  setup();
  expect(screen.getByText("Pictures in text: 0/1 made")).toBeTruthy();
  expect(screen.getByText("diagram — Addition · Planned")).toBeTruthy();
  expect(screen.getByText("No suitable video: No suitable named educator found")).toBeTruthy();
});

it.each([true, false])("lists notes outside the new plan even with an empty plan body (%s)", (empty) => {
  if (empty) {
    planBody = "";
    chapters = [];
  }
  otherNotes = [{ path: "notes/01-old-polymers.md", title: "Old polymers", order: 1, status: "accepted" }];
  setup();
  expect(screen.getByRole("region", { name: "Other notes in this set" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "Old polymers" }).getAttribute("href")).toBe(
    "/s/linear-algebra/n/01-old-polymers.md",
  );
});

it("opens the existing file editor for PLAN.md", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "Edit plan text" }));
  expect(screen.getByText("Editing PLAN.md")).toBeTruthy();
});
