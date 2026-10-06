import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import RecentlyDeletedSection from "./RecentlyDeletedSection";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("lists deleted items, restores their commit and offers the restored location", async () => {
  const item = {
    sha: "deleted",
    date: "2026-10-06T00:00:00Z",
    kind: "note" as const,
    set: "alpha",
    path: "notes/01-vectors.md",
    title: "Vectors",
    exportedCards: 2,
    retainedIgnoredFiles: 0,
  };
  vi.spyOn(api.sets, "recentlyDeleted").mockResolvedValueOnce([item]).mockResolvedValue([]);
  vi.spyOn(api.sets, "restore").mockResolvedValue({ sha: "restored" });
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <RecentlyDeletedSection />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  fireEvent.click(await screen.findByRole("button", { name: "Restore Vectors" }));
  await waitFor(() => expect(api.sets.restore).toHaveBeenCalledWith("alpha", "deleted"));
  expect((await screen.findByRole("link", { name: "Open" })).getAttribute("href")).toBe("/s/alpha/n/01-vectors.md");
  expect(await screen.findByText("Nothing deleted")).toBeTruthy();
});
