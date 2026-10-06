import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import ActivityPanelContent from "./ActivityPanelContent";

const state = vi.hoisted(() => ({ role: "ADMIN" }));

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
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
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
