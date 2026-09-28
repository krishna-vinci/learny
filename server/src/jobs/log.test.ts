import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { JobView } from "@studium/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendJobLog, formatJobLogLine, jobLogPath } from "./log.js";

function makeJob(overrides: Partial<JobView> = {}): JobView {
  return {
    id: "job-1",
    kind: "draft-chapter",
    set: "linear-algebra",
    title: "Singular value decomposition",
    status: "done",
    progress: "",
    startedAt: "2026-09-29T09:59:00.000Z",
    finishedAt: "2026-09-29T10:00:30.000Z",
    usage: { input: 12_300, output: 2_100, cacheRead: 0, cacheWrite: 0, costUsd: 0.04 },
    result: { notePath: "notes/04-svd.md", commitSha: "abc1234def5678" },
    ...overrides,
  };
}

describe("formatJobLogLine", () => {
  it("matches the documented jobs.md line format", () => {
    expect(formatJobLogLine(makeJob())).toBe(
      '- 2026-09-29T10:00Z · draft-chapter · "Singular value decomposition" · done · 12.3k in / 2.1k out · $0.04 · commit abc1234',
    );
  });

  it("omits the commit segment when there is no commit and normalizes quotes", () => {
    const line = formatJobLogLine(
      makeJob({
        title: 'He said "hi"',
        result: undefined,
        usage: { input: 42, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
      }),
    );
    expect(line).toBe("- 2026-09-29T10:00Z · draft-chapter · \"He said 'hi'\" · done · 42 in / 0 out · $0.00");
  });
});

describe("appendJobLog", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-jobslog-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("appends set jobs to <set>/log/jobs.md", async () => {
    const rel = await appendJobLog(root, makeJob());
    expect(rel).toBe("linear-algebra/log/jobs.md");

    await appendJobLog(root, makeJob({ title: "Second" }));
    const lines = (await fs.readFile(path.join(root, "linear-algebra/log/jobs.md"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"Second"');
  });

  it("logs set-less jobs to library/_jobs.md", async () => {
    expect(jobLogPath(makeJob({ set: null }))).toBe("library/_jobs.md");
    await appendJobLog(root, makeJob({ set: null, kind: "ingest" }));
    const text = await fs.readFile(path.join(root, "library/_jobs.md"), "utf8");
    expect(text).toContain("· ingest ·");
  });
});
