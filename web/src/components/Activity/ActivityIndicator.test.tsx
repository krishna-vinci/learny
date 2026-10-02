import type { JobView } from "@studium/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { queryKeys } from "@/api/queries";
import { DesktopActivityIndicator, MobileActivityIndicator } from "./ActivityIndicator";
import { closeActivityPanel } from "./activity-store";

vi.mock("@/hooks/useMediaQuery", () => ({ useMediaQuery: () => desktop }));
vi.mock("@/api/client", () => ({ api: { jobs: { list: vi.fn() }, sets: { list: vi.fn() } } }));
let desktop = true;
beforeEach(() => {
  desktop = true;
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
    return {
      x: 8,
      y: 840,
      left: 8,
      right: this.tagName === "BUTTON" ? 40 : 360,
      top: 840,
      bottom: 880,
      width: this.tagName === "BUTTON" ? 32 : 352,
      height: 40,
      toJSON() {},
    };
  });
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(448);
});
afterEach(() => {
  cleanup();
  closeActivityPanel();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity, retry: false } } });
  client.setQueryData(queryKeys.jobs(), [
    {
      id: "running",
      kind: "plan-set",
      status: "running",
      title: "Plan",
      set: "history",
      startedAt: new Date().toISOString(),
    },
    {
      id: "failed",
      kind: "ingest",
      status: "failed",
      title: "Failed source",
      set: "history",
      startedAt: new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      error: "A long error with details that must remain fully readable",
    },
  ] as JobView[]);
  client.setQueryData(queryKeys.sets, []);
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <div data-testid="rail">
          <DesktopActivityIndicator />
          <MobileActivityIndicator />
        </div>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
it("portals outside the rail, clamps/flips the desktop panel and closes with Escape", () => {
  setup();
  fireEvent.click(screen.getByRole("button", { name: "1 background job queued or running" }));
  const panel = screen.getByRole("dialog", { name: "Background activity" });
  expect(screen.getByTestId("rail").contains(panel)).toBe(false);
  expect(panel.style.left).toBe("8px");
  expect(Number.parseFloat(panel.style.top)).toBeLessThan(840);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("expands full failed text, preserves the footer, closes on outside click and navigation", () => {
  setup();
  const trigger = screen.getByRole("button", { name: "1 background job queued or running" });
  fireEvent.click(trigger);
  const summary = screen.getByText("Show error");
  fireEvent.click(summary);
  expect((summary.parentElement as HTMLDetailsElement).open).toBe(true);
  expect(screen.getByText(/A long error/).className).toContain("break-words");
  expect(screen.getByRole("link", { name: "View all jobs" })).toBeTruthy();
  const close = screen.getAllByRole("button", { name: "Close activity" }).at(0);
  if (!close) throw new Error("Missing activity backdrop");
  fireEvent.click(close);
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(trigger);
  fireEvent.click(screen.getByRole("link", { name: "View all jobs" }));
  expect(screen.queryByRole("dialog")).toBeNull();
});
it("keeps the mobile sheet portalled and closable", () => {
  desktop = false;
  setup();
  fireEvent.click(screen.getByRole("button", { name: "1 background job queued or running" }));
  expect(screen.getByTestId("rail").contains(screen.getByRole("dialog"))).toBe(false);
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
});
