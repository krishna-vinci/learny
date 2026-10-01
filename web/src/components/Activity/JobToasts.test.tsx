import type { JobView, StudiumEvent } from "@studium/shared";
import { act, cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { useStudiumEvents } from "@/api/events";
import { toast } from "@/lib/notify";
import { JobToasts } from "./JobToasts";

vi.mock("@/api/events", () => ({ useStudiumEvents: vi.fn() }));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("offers Add a source on a failed draft and opens the Library", () => {
  let listener: ((event: StudiumEvent) => void) | undefined;
  vi.mocked(useStudiumEvents).mockImplementation((callback) => {
    listener = callback;
  });
  const errorToast = vi.spyOn(toast, "error").mockReturnValue("missing-sources");
  render(
    <MemoryRouter initialEntries={["/jobs"]}>
      <JobToasts />
      <Routes>
        <Route path="/jobs" element={<p>Activity</p>} />
        <Route path="/library" element={<p>Library</p>} />
      </Routes>
    </MemoryRouter>,
  );
  act(() =>
    listener?.({
      type: "job",
      job: {
        id: "no-sources",
        kind: "draft-chapter",
        title: "History",
        status: "failed",
        error: "This set has no sources yet. Add a source in the Library (or ask the tutor to find some), then retry.",
      } as JobView,
    }),
  );
  const options = errorToast.mock.calls[0]?.[1];
  expect(options?.action?.label).toBe("Add a source");
  // Run the callback that the toast's action button invokes.
  act(() => options?.action?.onClick());
  expect(screen.getByText("Library")).toBeTruthy();
});
