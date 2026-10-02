import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import LibraryPage from "./LibraryPage";

vi.mock("@/api/queries", () => ({
  useSets: () => ({
    data: [
      { slug: "history", title: "History" },
      { slug: "algebra", title: "Algebra" },
    ],
  }),
  useLibrary: () => ({
    data: [
      {
        id: "lib-own",
        title: "History material",
        authors: ["Author"],
        type: "book",
        credibility: "A",
        parseTier: "basic",
        sets: ["history"],
      },
      {
        id: "lib-other",
        title: "Algebra material",
        authors: ["Author"],
        type: "book",
        credibility: "A",
        parseTier: "basic",
        sets: ["algebra"],
      },
    ],
    isLoading: false,
  }),
}));
vi.mock("@/components/Library/AddSourceSheet", () => ({ AddSourceSheet: () => null }));
afterEach(cleanup);
it("defaults to all sources and combines the set filter with search", () => {
  render(
    <MemoryRouter>
      <LibraryPage />
    </MemoryRouter>,
  );
  expect(screen.getByText("History material")).toBeTruthy();
  expect(screen.getByText("Algebra material")).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Study set" }), { target: { value: "history" } });
  expect(screen.getByText("History material")).toBeTruthy();
  expect(screen.queryByText("Algebra material")).toBeNull();
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Algebra" } });
  expect(screen.queryByText("History material")).toBeNull();
  expect(screen.getByText(/No sources match this filter/)).toBeTruthy();
  fireEvent.change(screen.getByRole("combobox", { name: "Study set" }), { target: { value: "" } });
  expect(screen.getByText("Algebra material")).toBeTruthy();
});
