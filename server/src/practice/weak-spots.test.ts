import type { PracticeLog } from "@studium/shared";
import { expect, it } from "vitest";
import { isDue, rebuildWeakSpots, updateWeakSpot, weakTopics } from "./weak-spots.js";

const attempt = {
  topic: " VECTORS ",
  note: "notes/01-vectors.md",
  score: 1,
  createdAt: "2026-10-01T12:00:00.000Z",
  gap: "",
};
it("normalizes keys, applies EMA, and doubles/caps/resets the interval ladder", () => {
  expect(updateWeakSpot(undefined, { ...attempt, score: 0.4 }).strength).toBe(0);
  expect(updateWeakSpot(undefined, { ...attempt, score: 0.7 }).strength).toBe(0.5);
  let spot = updateWeakSpot(undefined, attempt);
  expect(spot).toMatchObject({ topic: "vectors", strength: 1, attempts: 1, intervalDays: 1, nextReview: "2026-10-02" });
  for (const intervalDays of [2, 4, 8, 16, 16]) {
    spot = updateWeakSpot(spot, attempt);
    expect(spot.intervalDays).toBe(intervalDays);
  }
  spot = updateWeakSpot(spot, { ...attempt, score: 0, gap: "Missed idea" });
  expect(spot).toMatchObject({ strength: 0.5, intervalDays: 1, attempts: 7, gap: "Missed idea" });
  spot = updateWeakSpot(spot, { ...attempt, score: 0.5 });
  expect(spot.strength).toBe(0.5);
  expect(spot.intervalDays).toBe(1);
  expect(isDue(spot, new Date("2026-10-02T00:00:00Z"))).toBe(true);
  expect(
    weakTopics([spot, { ...spot, topic: "strong", strength: 1, nextReview: "2026-10-09" }], new Date("2026-10-01")),
  ).toEqual([spot]);
});
it("rebuilds old and mirrored chat logs exactly once, preserving distinct notes and teachback gaps", () => {
  const line = "- 2026-10-01T12:00:00.000Z | topic: Vectors | question: Why? | verdict: wrong | gap: Missed direction";
  const entries: PracticeLog[] = [
    { ...attempt, id: "chat-1", kind: "chat", score: 0, chatLogLine: line },
    {
      ...attempt,
      id: "teach-1",
      kind: "teachback",
      note: "notes/02-matrices.md",
      weaknesses: [{ topic: "rank", gap: "Missing rank", score: 0 }],
    },
  ];
  const result = rebuildWeakSpots(
    entries,
    `${line}\n- 2026-09-30T12:00:00Z | topic: eigenvalues | question: What? | verdict: partial\n`,
  );
  expect(result).toHaveLength(4);
  expect(result.filter((s) => s.topic === "vectors").map((s) => s.attempts)).toEqual([1, 1]);
  expect(result.find((s) => s.topic === "rank")).toMatchObject({ strength: 0, gap: "Missing rank" });
  expect(result.find((s) => s.topic === "eigenvalues")).toMatchObject({ strength: 0.5, note: "" });
});
