import type { StudiumEvent } from "@studium/shared";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { queryKeys, useLiveStudiumUpdates } from "./queries";

const stream = vi.hoisted(() => ({ handler: null as ((event: unknown) => void) | null }));

vi.mock("./events", () => ({
  useStudiumEvents: (handler: (event: unknown) => void) => {
    stream.handler = handler;
  },
}));

function job(status: "queued" | "running" | "done" | "failed" | "cancelled", progress: string) {
  return {
    id: "job-1",
    kind: "draft-chapter" as const,
    set: "algebra",
    title: "Draft vectors",
    status,
    progress,
    startedAt: null,
    finishedAt: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
    billing: "subscription" as const,
  };
}

describe("useLiveStudiumUpdates", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    stream.handler = null;
  });

  it("invalidates Today on file/commit and job status changes, not progress ticks", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(queryKeys.jobs(), [job("queued", "Waiting")]);
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");

    renderHook(() => useLiveStudiumUpdates(), {
      wrapper: ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>,
    });

    const emit = (event: StudiumEvent) => act(() => stream.handler?.(event));
    const todayInvalidationCount = () =>
      invalidate.mock.calls.filter(([filters]) => filters?.queryKey?.[0] === queryKeys.today[0]).length;

    emit({ type: "job", job: job("running", "Starting") });
    expect(todayInvalidationCount()).toBe(1);
    emit({ type: "job", job: job("running", "Reading source") });
    expect(todayInvalidationCount()).toBe(1);
    emit({ type: "job", job: job("done", "Finished") });
    expect(todayInvalidationCount()).toBe(2);
    emit({ type: "job", job: job("done", "Finished with usage") });
    expect(todayInvalidationCount()).toBe(2);
    emit({ type: "file", set: "algebra", path: "notes/vectors.md", change: "change" });
    expect(todayInvalidationCount()).toBe(3);
    emit({ type: "commit", sha: "sha", subject: "Draft vectors", author: "drafter" });
    expect(todayInvalidationCount()).toBe(4);
  });
});
