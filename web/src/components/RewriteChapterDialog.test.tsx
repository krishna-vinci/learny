import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { RewriteChapterDialog } from "./RewriteChapterDialog";

vi.mock("@/api/client", () => ({ api: { jobs: { create: vi.fn().mockResolvedValue({ jobId: "rewrite" }) } } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});
it("explains History undo and starts a rewrite for the exact note only after confirmation", async () => {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <RewriteChapterDialog set="history" path="notes/04-city.md" open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
  expect(screen.getByText("Keeps facts and sources; you can undo the rewrite from History.")).toBeTruthy();
  expect(api.jobs.create).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Rewrite" }));
  await waitFor(() =>
    expect(api.jobs.create).toHaveBeenCalledWith({ kind: "rewrite-chapter", set: "history", path: "notes/04-city.md" }),
  );
});
