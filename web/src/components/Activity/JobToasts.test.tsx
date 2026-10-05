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

it("summarizes refresh quality, skipped sources and vanished sections once", () => {
  let listener: ((event: StudiumEvent) => void) | undefined;
  vi.mocked(useStudiumEvents).mockImplementation((callback) => {
    listener = callback;
  });
  const success = vi.spyOn(toast, "success").mockReturnValue("refresh-result");
  render(
    <MemoryRouter>
      <JobToasts />
    </MemoryRouter>,
  );
  const event: StudiumEvent = {
    type: "job",
    job: {
      id: "refresh",
      kind: "refresh-source",
      status: "done",
      result: {
        refreshes: [
          { sourceId: "lib-a", before: 65, after: 100, status: "refreshed", disappearedAnchors: ["old"] },
          { sourceId: "lib-b", before: 95, after: 95, status: "skipped", disappearedAnchors: [], reason: "Blocked" },
        ],
      },
    } as JobView,
  };
  act(() => {
    listener?.(event);
    listener?.(event);
  });
  expect(success).toHaveBeenCalledTimes(1);
  expect(success.mock.calls[0]?.[0]).toBe("1 refreshed; 1 skipped; 0 unchanged; 1 sections no longer found");
});

it("keeps the latest identical refresh summary when repeated jobs complete", () => {
  let listener: ((event: StudiumEvent) => void) | undefined;
  vi.mocked(useStudiumEvents).mockImplementation((callback) => {
    listener = callback;
  });
  vi.spyOn(toast, "success").mockReturnValue("same-refresh-summary");
  const dismiss = vi.spyOn(toast, "dismiss");
  render(
    <MemoryRouter>
      <JobToasts />
    </MemoryRouter>,
  );
  act(() => {
    for (let n = 0; n < 4; n++)
      listener?.({
        type: "job",
        job: {
          id: `repeat-${n}`,
          kind: "refresh-source",
          title: "Refresh",
          set: null,
          progress: "",
          startedAt: null,
          finishedAt: null,
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
          billing: "metered",
          status: "done",
          result: { refreshes: [] },
        },
      });
  });
  expect(dismiss.mock.calls.some(([id]) => id === "same-refresh-summary")).toBe(false);
});
