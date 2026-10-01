import type { PracticeLog, WeakSpot } from "@studium/shared";

const DAY = 86_400_000;
// EMA alpha = 0.5. A first observation starts at its verdict score.
export function updateWeakSpot(
  previous: WeakSpot | undefined,
  attempt: { topic: string; note: string; score: number; createdAt: string; gap: string },
): WeakSpot {
  const interval =
    previous === undefined || attempt.score < 0.5
      ? 1
      : attempt.score >= 0.8
        ? Math.min(16, previous.intervalDays * 2)
        : previous.intervalDays;
  const score = attempt.score >= 0.8 ? 1 : attempt.score >= 0.5 ? 0.5 : 0;
  return {
    topic: attempt.topic.trim().toLowerCase(),
    note: attempt.note,
    strength: previous === undefined ? score : previous.strength * 0.5 + score * 0.5,
    attempts: (previous?.attempts ?? 0) + 1,
    lastSeen: attempt.createdAt,
    intervalDays: interval as WeakSpot["intervalDays"],
    nextReview: new Date(Date.parse(attempt.createdAt.slice(0, 10)) + interval * DAY).toISOString().slice(0, 10),
    gap: attempt.gap,
  };
}

export function isDue(spot: WeakSpot, now: Date): boolean {
  return spot.nextReview <= now.toISOString().slice(0, 10);
}
export function weakTopics(spots: WeakSpot[], now: Date): WeakSpot[] {
  return spots
    .filter((spot) => spot.strength < 0.6 || isDue(spot, now))
    .sort(
      (a, b) => a.strength - b.strength || a.nextReview.localeCompare(b.nextReview) || a.topic.localeCompare(b.topic),
    );
}

/** Rebuild both sources, removing only chat lines already mirrored in JSONL. */
export function rebuildWeakSpots(attempts: PracticeLog[], quizLog: string): WeakSpot[] {
  const mirrored = new Map<string, number>();
  for (const entry of attempts)
    if (entry.chatLogLine !== undefined) mirrored.set(entry.chatLogLine, (mirrored.get(entry.chatLogLine) ?? 0) + 1);
  const legacy: PracticeLog[] = [];
  for (const line of quizLog.split(/\r?\n/)) {
    const remaining = mirrored.get(line) ?? 0;
    if (remaining > 0) {
      mirrored.set(line, remaining - 1);
      continue;
    }
    const match =
      /^- (\S+) \| topic: (.*?) \| question: (.*?) \| verdict: (right|partial|wrong)(?: \| gap: (.*?))?(?: \| note: (notes\/[^|]+\.md))?$/.exec(
        line,
      );
    if (!match || !Number.isFinite(Date.parse(match[1] ?? ""))) continue;
    legacy.push({
      id: `legacy-${legacy.length}`,
      kind: "chat",
      createdAt: new Date(match[1] as string).toISOString(),
      note: match[6] ?? "",
      topic: (match[2] ?? "").replaceAll("\\|", "|"),
      score: match[4] === "right" ? 1 : match[4] === "partial" ? 0.5 : 0,
      gap: (match[5] ?? "").replaceAll("\\|", "|"),
    });
  }
  const spots = new Map<string, WeakSpot>();
  for (const attempt of [...attempts, ...legacy].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    // Each teach-back logs once, but its separate gaps update their own topics.
    const observations = new Map<string, { topic: string; gap: string; score: number }>();
    for (const observation of [
      { topic: attempt.topic, gap: attempt.gap, score: attempt.score },
      ...(attempt.weaknesses ?? []),
    ])
      observations.set(observation.topic.trim().toLowerCase(), observation);
    for (const observation of observations.values()) {
      const key = JSON.stringify([observation.topic.trim().toLowerCase(), attempt.note]);
      spots.set(key, updateWeakSpot(spots.get(key), { ...attempt, ...observation }));
    }
  }
  return [...spots.values()].sort((a, b) => a.topic.localeCompare(b.topic) || a.note.localeCompare(b.note));
}
