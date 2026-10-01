import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "@/api/client";
import { usePlanProposal } from "@/api/queries";
import { toast } from "@/lib/notify";
import { PlanReview } from "./InboxPlanReview";

vi.mock("@/api/queries", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/queries")>();
  return { ...actual, usePlanProposal: vi.fn() };
});

vi.mock("@/components/Reader", () => ({
  MarkdownView: ({ content }: { content: string }) => <div>{content}</div>,
}));

const plan = `---
title: "Linear algebra"
---

## Goal
Learn linear algebra.
`;

const proposal = {
  plan,
  curriculum: `\`\`\`markdown
- [ ] 99 — Fenced decoy
\`\`\`
- [ ] Legacy parser chapter
`,
  sourcesToAdd: [],
  chapters: [
    { number: 1, title: "Completed chapter", scope: "Already drafted", prerequisites: "none", ticked: true },
    { number: 2, title: "Vectors from API", scope: "Vectors", prerequisites: "none", ticked: false },
    { number: 3, title: "Matrices from API", scope: "Matrices", prerequisites: "2", ticked: false },
  ],
};

function renderReview() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <PlanReview
          set="algebra"
          item={{
            path: "plan-proposals/linear-algebra.md",
            title: "Linear algebra",
            status: "draft",
            check: null,
            updatedAt: "2026-10-01T00:00:00.000Z",
          }}
          onBack={() => {}}
        />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

describe("plan proposal review", () => {
  beforeEach(() => {
    vi.mocked(usePlanProposal).mockReturnValue({ data: proposal } as unknown as ReturnType<typeof usePlanProposal>);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("previews unticked API chapters and submits their count", async () => {
    const approvePlan = vi
      .spyOn(api.inbox, "approvePlan")
      .mockResolvedValue({ sha: "sha", jobIds: [], ingestJobIds: [] });
    renderReview();

    const preview = screen.getByRole("heading", { name: "These chapters will be drafted now" }).closest("section");
    expect(preview).toBeTruthy();
    expect(within(preview as HTMLElement).getByText("Vectors from API")).toBeTruthy();
    expect(within(preview as HTMLElement).getByText("Matrices from API")).toBeTruthy();
    expect(within(preview as HTMLElement).queryByText("Completed chapter")).toBeNull();
    expect(screen.queryByText("Fenced decoy")).toBeNull();
    expect(screen.queryByText("Legacy parser chapter")).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Approve & draft first 2" }));
    await waitFor(() => expect(approvePlan).toHaveBeenCalledWith("algebra", "linear-algebra.md", 2));
  });

  it("explains source ingestion before drafting and toasts the deferred kickoff", async () => {
    vi.mocked(usePlanProposal).mockReturnValue({
      data: { ...proposal, sourcesToAdd: ["https://example.org/course"] },
    } as unknown as ReturnType<typeof usePlanProposal>);
    const approvePlan = vi
      .spyOn(api.inbox, "approvePlan")
      .mockResolvedValue({ sha: "sha", jobIds: [], ingestJobIds: ["ingest-1"] });
    const success = vi.spyOn(toast, "success");
    renderReview();
    expect(screen.getByText("Drafting starts after the sources are added.")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "These chapters will be drafted after sources are added" }),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Add 1 sources & draft first 2" }));
    await waitFor(() => expect(approvePlan).toHaveBeenCalledWith("algebra", "linear-algebra.md", 2));
    await waitFor(() => expect(success).toHaveBeenCalledWith("Adding 1 sources — chapters will be drafted after"));
  });

  it("keeps approval available when an older response has no chapter data", async () => {
    vi.mocked(usePlanProposal).mockReturnValue({
      data: { plan, curriculum: "- [ ] 01 — Unsafe fallback", sourcesToAdd: [] },
    } as unknown as ReturnType<typeof usePlanProposal>);
    const approvePlan = vi
      .spyOn(api.inbox, "approvePlan")
      .mockResolvedValue({ sha: "sha", jobIds: [], ingestJobIds: [] });
    renderReview();

    expect(screen.getByText("Draft preview unavailable.")).toBeTruthy();
    expect(screen.queryByText("Unsafe fallback")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(approvePlan).toHaveBeenCalledWith("algebra", "linear-algebra.md", 0));
  });
});
