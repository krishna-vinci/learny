import type { JobUsage } from "@studium/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import ActivityPanelContent from "./ActivityPanelContent";

const state = vi.hoisted(() => ({
  role: "ADMIN",
  usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 } as JobUsage | undefined,
}));

vi.mock("@/api/queries", () => ({
  queryKeys: { course: (set: string) => ["sets", set, "course"] },
  useJobs: () => ({
    data: [
      {
        id: "job-1",
        kind: "ingest",
        set: null,
        title: "A blocked video",
        status: "done",
        progress: "Source ready",
        startedAt: null,
        finishedAt: new Date().toISOString(),
        usage: state.usage,
        billing: "metered",
        result: { sourceId: "lib-video", warning: "stored warning", transcriptStatus: "blocked" },
      },
    ],
  }),
  useSets: () => ({ data: [] }),
  useCurrentUser: () => ({ user: { role: state.role } }),
}));

afterEach(() => {
  cleanup();
  state.role = "ADMIN";
  state.usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
});

function renderPanel() {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ActivityPanelContent />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

it("links admins from a blocked ingest warning to Settings -> Integrations", () => {
  renderPanel();
  const link = screen.getByRole("link", { name: "Set up YouTube sign-in" });
  expect(link.getAttribute("href")).toBe("/settings/integrations");
});

it("asks members to contact their admin instead of linking to Settings", () => {
  state.role = "USER";
  renderPanel();
  expect(screen.queryByRole("link", { name: "Set up YouTube sign-in" })).toBeNull();
  expect(screen.getByText(/ask your admin/)).toBeTruthy();
});

it("renders legacy jobs without usage while preserving warnings and navigation", () => {
  state.usage = undefined;
  renderPanel();
  expect(screen.getByText("A blocked video")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Set up YouTube sign-in" })).toBeTruthy();
  expect(screen.getByRole("link", { name: "View all jobs" }).getAttribute("href")).toBe("/jobs");
  expect(screen.queryByText(/Exa/)).toBeNull();
});

it("displays token usage and Exa requests and cost when recorded", () => {
  state.usage = { input: 120, output: 30, cacheRead: 0, cacheWrite: 0, costUsd: 0, exaRequests: 3, exaCostUsd: 0.021 };
  renderPanel();
  expect(screen.getByText("120 in · 30 out · Exa 3 requests / $0.021")).toBeTruthy();
});
