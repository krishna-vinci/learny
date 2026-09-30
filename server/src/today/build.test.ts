import type { CardFileView, CommitInfo, InboxItem, JobView } from "@studium/shared";
import { describe, expect, it } from "vitest";
import { buildToday, parseNextChapter, type TodaySetInput } from "./build.js";

const NOW = new Date("2026-09-30T18:30:00Z");

function set(slug: string, patch: Partial<TodaySetInput> = {}): TodaySetInput {
  return {
    slug,
    title: slug,
    status: "active",
    level: null,
    deadline: null,
    nextAction: null,
    inbox: [],
    cardFiles: [],
    jobs: [],
    commits: [],
    chatActivity: [NOW.toISOString()],
    curriculum: null,
    notesCount: 0,
    ...patch,
  };
}

const inbox: InboxItem[] = [
  { path: "notes/01-vectors.md", title: "Vectors", status: "checked", check: null, updatedAt: NOW.toISOString() },
];
const cardFile: CardFileView = {
  path: "cards/01-vectors.md",
  note: "notes/01-vectors.md",
  deck: "Vectors",
  stale: true,
  noteCommitsSince: 1,
  counts: { draft: 3, approved: 1, rejected: 2, exported: 0 },
};
const cardFiles = [cardFile];

function commit(author: string, date: string): CommitInfo {
  return { sha: "a".repeat(40), author, date, subject: `${author}: edit` };
}

function job(status: JobView["status"]): JobView {
  return {
    id: status,
    kind: "draft-chapter",
    set: "stats",
    title: status,
    status,
    progress: "",
    startedAt: null,
    finishedAt: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
    billing: "metered",
  };
}

describe("buildToday", () => {
  it("orders all six priorities, drafts by deadline, and caps suggestions at seven", () => {
    const view = buildToday(
      [
        set("later", { deadline: "2026-10-10", curriculum: "- [ ] Later" }),
        set("idle", { chatActivity: ["2026-09-23T18:30:00Z"] }),
        set("cards", { cardFiles }),
        set("review", { inbox }),
        set("overdue", { deadline: "2026-09-29", nextAction: "Finish chapter 1" }),
        set("soon", { deadline: "2026-10-01", curriculum: "- [ ] Soon" }),
        set("no-deadline", { curriculum: "- [ ] Eventually" }),
        set("paused", { status: "paused", curriculum: "- [ ] Paused" }),
      ],
      NOW,
    );
    expect(view.doNext.map((item) => [item.kind, item.set])).toEqual([
      ["overdue", "overdue"],
      ["inbox", "review"],
      ["draft-cards", "cards"],
      ["stale-cards", "cards"],
      ["next-chapter", "soon"],
      ["next-chapter", "later"],
      ["next-chapter", "no-deadline"],
    ]);
    const idle = buildToday([set("idle", { chatActivity: ["2026-09-23T18:30:00Z"] })], NOW);
    expect(idle.doNext).toEqual([expect.objectContaining({ kind: "inactive", set: "idle", href: "/s/idle" })]);
    expect(view.doNext[1]?.href).toBe("/s/review/inbox");
    expect(view.doNext[2]?.href).toBe("/s/cards/cards");
  });

  it("uses UTC calendar dates, retains negative days, and requires overdue work", () => {
    const view = buildToday(
      [
        set("yesterday", { deadline: "2026-09-29", inbox }),
        set("today", { deadline: "2026-09-30", nextAction: "Read" }),
        set("tomorrow", { deadline: "2026-10-01" }),
        set("no-work", { deadline: "2026-09-28" }),
        set("no-date"),
        set("bad-date", { deadline: "2026-02-31" }),
      ],
      NOW,
    );
    expect(view.sets.map((item) => item.daysLeft)).toEqual([-1, 0, 1, -2, null, null]);
    expect(view.doNext.filter((item) => item.kind === "overdue").map((item) => item.set)).toEqual(["yesterday"]);
  });

  it("counts cards, keeps only live jobs, and uses the latest user commit or chat", () => {
    const view = buildToday(
      [
        set("stats", {
          cardFiles: [...cardFiles, { ...cardFile, stale: false }],
          inbox,
          notesCount: 4,
          jobs: [job("queued"), job("running"), job("done"), job("failed"), job("cancelled")],
          commits: [commit("drafter", "2026-09-30T18:00:00Z"), commit("user", "2026-09-22T12:00:00Z")],
          chatActivity: ["2026-09-23T18:30:01Z"],
        }),
        set("user-later", {
          commits: [commit("user", "2026-09-29T12:00:00Z")],
          chatActivity: ["2026-09-21T12:00:00Z"],
        }),
      ],
      NOW,
    );
    expect(view.sets[0]).toMatchObject({
      inboxCount: 1,
      draftCards: 6,
      staleCardFiles: 1,
      notesCount: 4,
      lastStudiedAt: "2026-09-23T18:30:01.000Z",
    });
    expect(view.sets[0]?.runningJobs.map((item) => item.status)).toEqual(["queued", "running"]);
    expect(view.sets[1]?.lastStudiedAt).toBe("2026-09-29T12:00:00.000Z");
    expect(view.doNext.some((item) => item.kind === "inactive")).toBe(false);
  });

  it("handles no sets and a set with no content or activity", () => {
    expect(buildToday([], NOW)).toEqual({ sets: [], doNext: [] });
    const view = buildToday([set("empty", { chatActivity: [] })], NOW);
    expect(view.sets[0]).toMatchObject({
      daysLeft: null,
      inboxCount: 0,
      draftCards: 0,
      staleCardFiles: 0,
      runningJobs: [],
      lastStudiedAt: null,
      nextChapter: null,
      notesCount: 0,
    });
    expect(view.doNext).toEqual([expect.objectContaining({ kind: "inactive", set: "empty" })]);
  });
});

describe("parseNextChapter", () => {
  it("finds the first unchecked list item, ignoring completed tasks and code fences", () => {
    expect(
      parseNextChapter(
        "# Curriculum\r\n- [x] Done\r\n* [X] Also done\r\n```md\r\n- [ ] Example\r\n```\r\n  1. [ ] Matrices\r\n- [ ] SVD\r\n",
      ),
    ).toBe("Matrices");
    expect(parseNextChapter("~~~md\n- [ ] Example\n~~~\n+ [ ] Vectors")).toBe("Vectors");
  });

  it("returns null for a missing or finished curriculum", () => {
    expect(parseNextChapter(null)).toBeNull();
    expect(parseNextChapter("# Curriculum\n- [x] Done\n- [ ]   \n")).toBeNull();
  });
});
