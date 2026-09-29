import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { JobView } from "@studium/shared";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendJobLog, formatJobLogLine, jobLogPath, loadJobHistory, parseJobLogLine } from "./log.js";

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
    billing: "metered",
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

describe("persisted job history", () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-jobhistory-"));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("parses the documented format and ignores malformed lines", () => {
    expect(
      parseJobLogLine(
        '- 2026-09-29T10:00Z · draft-chapter · "Singular value decomposition" · done · 12.3k in / 2.1k out · $0.04 · commit abc1234',
        "linear-algebra",
      ),
    ).toEqual({
      kind: "draft-chapter",
      set: "linear-algebra",
      title: "Singular value decomposition",
      status: "done",
      progress: "",
      startedAt: null,
      finishedAt: "2026-09-29T10:00Z",
      usage: { input: 12_300, output: 2_100, cacheRead: 0, cacheWrite: 0, costUsd: 0.04 },
      billing: "metered",
      result: { commitSha: "abc1234" },
    });
    expect(parseJobLogLine("not a job", "linear-algebra")).toBeNull();
  });

  it("loads set and library logs newest first with stable line ids and a limit", async () => {
    await fs.mkdir(path.join(root, "alpha/log"), { recursive: true });
    await fs.mkdir(path.join(root, "library"), { recursive: true });
    await fs.writeFile(path.join(root, "alpha/PLAN.md"), "---\ntitle: Alpha\nstatus: active\n---\n");
    await fs.writeFile(
      path.join(root, "alpha/log/jobs.md"),
      ["heading ignored", '- 2026-09-29T09:00Z · make-cards · "Cards" · failed · 100 in / 20 out · $0.01'].join("\n"),
    );
    await fs.writeFile(
      path.join(root, "library/_jobs.md"),
      '- 2026-09-29T11:00Z · ingest · "Paper" · done · 1.0k in / 50 out · $0.02 · commit def5678\n',
    );

    const history = await loadJobHistory(root, 2);
    expect(history.map((job) => job.id)).toEqual(["log:library:1", "log:alpha:2"]);
    expect(history.map((job) => job.set)).toEqual([null, "alpha"]);
  });
});
