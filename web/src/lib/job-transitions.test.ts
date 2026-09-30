import type { JobView } from "@studium/shared";
import { describe, expect, it } from "vitest";
import { acceptJobCompletion, createJobTransitionTracker, isActiveJob, isRecentlyFinishedJob } from "./job-transitions";

function job(overrides: Partial<JobView> = {}): JobView {
  return {
    id: "job-1",
    kind: "draft-chapter",
    set: "linalg",
    title: "Singular value decomposition",
    status: "queued",
    progress: "",
    startedAt: null,
    finishedAt: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
    billing: "subscription",
    ...overrides,
  };
}

describe("acceptJobCompletion", () => {
  it("emits a done job once per id", () => {
    const seen = new Set<string>();
    expect(acceptJobCompletion(seen, job({ status: "running", progress: "drafting" }))).toBeNull();
    expect(acceptJobCompletion(seen, job({ status: "done", result: { notePath: "notes/svd.md" } }))).toEqual({
      job: job({ status: "done", result: { notePath: "notes/svd.md" } }),
      status: "done",
    });
    expect(acceptJobCompletion(seen, job({ status: "done" }))).toBeNull();
  });

  it("emits a failed job once per id", () => {
    const seen = new Set<string>();
    expect(acceptJobCompletion(seen, job({ status: "failed", error: "model unavailable" }))).toEqual({
      job: job({ status: "failed", error: "model unavailable" }),
      status: "failed",
    });
    expect(acceptJobCompletion(seen, job({ status: "failed", error: "model unavailable" }))).toBeNull();
  });

  it("ignores cancelled and non-terminal jobs", () => {
    const seen = new Set<string>();
    expect(acceptJobCompletion(seen, job({ status: "queued" }))).toBeNull();
    expect(acceptJobCompletion(seen, job({ status: "running" }))).toBeNull();
    expect(acceptJobCompletion(seen, job({ status: "cancelled", finishedAt: "2026-09-30T10:00:00Z" }))).toBeNull();
    expect(seen.size).toBe(0);
  });

  it("tracks job ids independently", () => {
    const seen = new Set<string>();
    expect(acceptJobCompletion(seen, job({ id: "a", status: "done" }))).not.toBeNull();
    expect(acceptJobCompletion(seen, job({ id: "b", status: "done" }))).not.toBeNull();
  });
});

describe("createJobTransitionTracker", () => {
  it("keeps one seen set across calls", () => {
    const track = createJobTransitionTracker();
    expect(track(job({ id: "a", status: "done" }))).not.toBeNull();
    expect(track(job({ id: "a", status: "done" }))).toBeNull();
    expect(track(job({ id: "b", status: "failed", error: "boom" }))).not.toBeNull();
  });
});

describe("isActiveJob", () => {
  it("counts queued and running jobs only", () => {
    expect(isActiveJob(job({ status: "queued" }))).toBe(true);
    expect(isActiveJob(job({ status: "running" }))).toBe(true);
    expect(isActiveJob(job({ status: "done" }))).toBe(false);
    expect(isActiveJob(job({ status: "failed" }))).toBe(false);
    expect(isActiveJob(job({ status: "cancelled" }))).toBe(false);
  });
});

describe("isRecentlyFinishedJob", () => {
  it("keeps a job finished during this browser session even when older than two hours", () => {
    const sessionStartedAt = Date.parse("2026-09-30T10:00:00Z");
    const now = Date.parse("2026-09-30T13:00:00Z");
    expect(
      isRecentlyFinishedJob(job({ status: "failed", finishedAt: "2026-09-30T10:30:00Z" }), sessionStartedAt, now),
    ).toBe(true);
  });

  it("keeps a job finished before this session but within the last two hours", () => {
    const sessionStartedAt = Date.parse("2026-09-30T12:00:00Z");
    const now = Date.parse("2026-09-30T13:00:00Z");
    expect(
      isRecentlyFinishedJob(job({ status: "failed", finishedAt: "2026-09-30T11:30:00Z" }), sessionStartedAt, now),
    ).toBe(true);
    expect(
      isRecentlyFinishedJob(job({ status: "failed", finishedAt: "2026-09-30T11:00:00Z" }), sessionStartedAt, now),
    ).toBe(true);
  });

  it("drops a job finished before this session and more than two hours ago", () => {
    const sessionStartedAt = Date.parse("2026-09-30T12:00:00Z");
    const now = Date.parse("2026-09-30T13:00:00Z");
    expect(
      isRecentlyFinishedJob(job({ status: "failed", finishedAt: "2026-09-30T10:59:59Z" }), sessionStartedAt, now),
    ).toBe(false);
    expect(
      isRecentlyFinishedJob(job({ status: "failed", finishedAt: "2026-09-29T09:00:00Z" }), sessionStartedAt, now),
    ).toBe(false);
  });

  it("keeps a finished job without a parseable timestamp", () => {
    const sessionStartedAt = Date.parse("2026-09-30T12:00:00Z");
    const now = Date.parse("2026-09-30T13:00:00Z");
    expect(isRecentlyFinishedJob(job({ status: "failed", finishedAt: null }), sessionStartedAt, now)).toBe(true);
    expect(isRecentlyFinishedJob(job({ status: "failed", finishedAt: "not-a-date" }), sessionStartedAt, now)).toBe(
      true,
    );
  });
});
