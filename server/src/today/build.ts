import type {
  CardFileView,
  CommitInfo,
  InboxItem,
  JobView,
  SetSummary,
  TodayItem,
  TodaySet,
  TodayView,
  WeakSpot,
} from "@studium/shared";
import { isDue, weakTopics } from "../practice/weak-spots.js";
import { type ChapterNote, chapterExists, parseCurriculum } from "../tree/curriculum.js";

export interface TodaySetInput extends SetSummary {
  inbox: InboxItem[];
  cardFiles: CardFileView[];
  jobs: JobView[];
  commits: CommitInfo[];
  chatActivity: string[];
  curriculum: string | null;
  notesCount: number;
  notePaths?: string[];
  notes?: ChapterNote[];
  weakSpots?: WeakSpot[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function parseNextChapter(
  curriculum: string | null,
  notes: readonly (ChapterNote | string)[] = [],
): string | null {
  return parseCurriculum(curriculum).find((chapter) => !chapterExists(chapter, notes))?.label ?? null;
}

function daysUntil(deadline: string | null, now: Date): number | null {
  if (deadline === null || !/^\d{4}-\d{2}-\d{2}$/.test(deadline)) return null;
  const due = Date.parse(`${deadline}T00:00:00Z`);
  if (!Number.isFinite(due) || new Date(due).toISOString().slice(0, 10) !== deadline) return null;
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.round((due - today) / DAY_MS);
}

function lastStudied(input: TodaySetInput): string | null {
  const dates = [
    ...input.commits.filter((commit) => commit.author === "user").map((commit) => commit.date),
    ...input.chatActivity,
  ];
  let latest: number | null = null;
  for (const date of dates) {
    const timestamp = Date.parse(date);
    if (Number.isFinite(timestamp) && (latest === null || timestamp > latest)) latest = timestamp;
  }
  return latest === null ? null : new Date(latest).toISOString();
}

function dueOrder(a: TodaySet, b: TodaySet): number {
  return (
    (a.daysLeft ?? Number.POSITIVE_INFINITY) - (b.daysLeft ?? Number.POSITIVE_INFINITY) || a.slug.localeCompare(b.slug)
  );
}

/** Build a Today view from workspace snapshots without filesystem access or mutation. */
export function buildToday(inputs: TodaySetInput[], now: Date): TodayView {
  const sets: TodaySet[] = inputs.map((input) => ({
    slug: input.slug,
    title: input.title,
    status: input.status,
    level: input.level,
    deadline: input.deadline,
    nextAction: input.nextAction,
    daysLeft: daysUntil(input.deadline, now),
    inboxCount: input.inbox.length,
    chaptersToReview: input.inbox.filter((item) => item.kind !== "plan").length,
    plansToReview: input.inbox.filter((item) => item.kind === "plan").length,
    draftCards: input.cardFiles.reduce((total, file) => total + file.counts.draft, 0),
    staleCardFiles: input.cardFiles.filter((file) => file.stale).length,
    runningJobs: input.jobs.filter((job) => job.status === "queued" || job.status === "running"),
    lastStudiedAt: lastStudied(input),
    nextChapter: parseNextChapter(input.curriculum, input.notes ?? input.notePaths),
    notesCount: input.notesCount,
    weakTopics: weakTopics(input.weakSpots ?? [], now).slice(0, 3),
    practiceDue: (input.weakSpots ?? []).filter((spot) => isDue(spot, now)).length,
  }));
  const ordered = [...sets].sort(dueOrder);
  const doNext: TodayItem[] = [];
  const add = (
    set: TodaySet,
    kind: TodayItem["kind"],
    title: string,
    detail: string,
    suffix = "",
    reviewKind?: TodayItem["reviewKind"],
  ) => {
    doNext.push({
      ...(reviewKind === undefined ? {} : { reviewKind }),
      kind,
      set: set.slug,
      title,
      detail,
      href: `/s/${set.slug}${suffix}`,
    });
  };

  // One suggestion per category per set keeps large inboxes from filling the list.
  for (const set of ordered) {
    if (set.daysLeft !== null && set.daysLeft < 0 && (set.inboxCount > 0 || set.nextAction)) {
      add(
        set,
        "overdue",
        set.title,
        `${Math.abs(set.daysLeft)} day(s) overdue · ${set.nextAction || `${set.chaptersToReview} chapter(s) and ${set.plansToReview} plan(s) awaiting review`}`,
        set.inboxCount > 0 ? "/inbox" : "",
      );
    }
  }
  for (const set of ordered) {
    if ((set.plansToReview ?? 0) > 0) {
      add(
        set,
        "inbox",
        "Review your study plan",
        `${set.title} · ${set.plansToReview} plan(s) awaiting review`,
        "/inbox",
        "plan",
      );
    }
    if ((set.chaptersToReview ?? 0) > 0) {
      add(
        set,
        "inbox",
        "Review chapters",
        `${set.title} · ${set.chaptersToReview} chapter(s) awaiting review`,
        "/inbox",
        "chapter",
      );
    }
  }
  for (const set of ordered) {
    if (set.draftCards > 0) {
      add(set, "draft-cards", "Review draft cards", `${set.title} · ${set.draftCards} draft card(s)`, "/cards");
    }
  }
  for (const set of ordered) {
    if (set.staleCardFiles > 0) {
      add(
        set,
        "stale-cards",
        "Refresh stale cards",
        `${set.title} · ${set.staleCardFiles} stale card file(s)`,
        "/cards",
      );
    }
  }
  for (const set of ordered) {
    for (const spot of set.weakTopics)
      add(set, "practice", `Practise ${spot.topic}`, set.title, `/practice?topic=${encodeURIComponent(spot.topic)}`);
  }
  for (const set of ordered) {
    if (set.status === "active" && set.nextChapter !== null) {
      add(set, "next-chapter", `Draft ${set.nextChapter}`, set.title);
    }
  }
  const inactive = ordered
    .filter((set) => set.lastStudiedAt === null || now.getTime() - Date.parse(set.lastStudiedAt) >= 7 * DAY_MS)
    .sort((a, b) => {
      const aTime = a.lastStudiedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(a.lastStudiedAt);
      const bTime = b.lastStudiedAt === null ? Number.NEGATIVE_INFINITY : Date.parse(b.lastStudiedAt);
      return aTime - bTime || a.slug.localeCompare(b.slug);
    });
  for (const set of inactive) {
    add(
      set,
      "inactive",
      set.lastStudiedAt === null ? "Start studying" : "Resume studying",
      `${set.title} · ${set.lastStudiedAt === null ? "No study activity yet" : "Not studied in 7+ days"}`,
    );
  }
  return { sets, doNext: doNext.slice(0, 7) };
}
