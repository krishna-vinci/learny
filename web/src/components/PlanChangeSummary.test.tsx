import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { chapterChanges, PlanChangeSummary } from "./PlanChangeSummary";

const chapter = (number: number, title: string, scope = title) => ({
  number,
  title,
  scope,
  prerequisites: "none",
  visuals: [],
  video: "",
  ticked: false,
});
afterEach(cleanup);
it("summarises added, removed, renamed, changed and unchanged chapters, including media changes", () => {
  const current = [chapter(1, "Same"), chapter(2, "Old"), chapter(3, "Changed"), chapter(4, "Remove")];
  const proposed = [
    chapter(1, "Same"),
    chapter(2, "Renamed", "Old"),
    { ...chapter(3, "Changed"), scope: "Updated", visuals: ["step-through — Bonds"], video: "New" },
    chapter(4, "Added"),
  ];
  expect(chapterChanges(current, proposed).map((c) => c.status)).toEqual([
    "unchanged",
    "renamed",
    "changed",
    "added",
    "removed",
  ]);
  render(<PlanChangeSummary current={current} proposed={proposed} />);
  for (const text of [
    "Unchanged: Same",
    "Renamed: Old → Renamed",
    "Changed: Changed",
    "Added: Added",
    "Removed: Remove",
  ])
    expect(screen.getByText(text, { exact: false })).toBeTruthy();
  expect(screen.getByText("Changed: scope, visuals, video")).toBeTruthy();
});
it("matches moved chapters by title rather than classifying them as renames", () => {
  const changes = chapterChanges([chapter(1, "A"), chapter(2, "B")], [chapter(1, "B"), chapter(2, "A")]);
  expect(changes.map((c) => [c.status, c.fields])).toEqual([
    ["changed", ["order"]],
    ["changed", ["order"]],
  ]);
});

it("uses recorded proposal origins when title and scope both change", () => {
  const changes = chapterChanges([chapter(1, "Before")], [chapter(1, "After", "New scope")], { "1": "Before" });
  expect(changes[0]).toMatchObject({ status: "renamed", fields: ["scope"] });
});

it("includes photo slot changes in the review summary", () => {
  const before = [chapter(1, "A")];
  const after = [{ ...chapter(1, "A"), images: ["Real polymer photo"] }];
  render(<PlanChangeSummary current={before} proposed={after} />);
  expect(screen.getByText("Changed: images")).toBeTruthy();
  expect(screen.getByText("After: Real polymer photo")).toBeTruthy();
});
