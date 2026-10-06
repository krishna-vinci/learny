import { expect, it } from "vitest";
import { chapterExists, parseCurriculum } from "./curriculum.js";

it("matches chapter identity rather than filename numbers, preferring explicit ids", () => {
  const chapter = parseCurriculum("- [ ] 01 — Atoms, molecules and the chemistry around you\n")[0];
  if (!chapter) throw new Error("missing fixture");
  expect(chapterExists(chapter, ["notes/01-polymers-from-carbon-bonds-to-everyday.md"])).toBe(false);
  expect(chapterExists(chapter, ["notes/03-atoms-molecules-and-the-chemistry.md"])).toBe(true);
  expect(chapterExists(chapter, [{ path: "notes/01-old.md", title: chapter.title }])).toBe(true);
  expect(
    chapterExists(chapter, [
      { path: "notes/09-renamed.md", title: "Renamed", chapter: "atoms-molecules-and-the-chemistry" },
    ]),
  ).toBe(true);
  expect(
    chapterExists(chapter, [
      { path: "notes/01-atoms-molecules-and-the-chemistry.md", title: chapter.title, chapter: "old-plan" },
    ]),
  ).toBe(false);
});

it("withInteractiveFallback adds a subject default to chapters planned before the interactive-visual rule", async () => {
  const { withInteractiveFallback, interactivePlanIssues } = await import("./curriculum.js");
  const legacy = { title: "Atoms and molecules", visuals: ["diagram — scales of matter"] };
  const fixed = withInteractiveFallback(legacy, "science");
  expect(fixed.visuals).toContain("step-through — Atoms and molecules");
  expect(interactivePlanIssues(fixed.visuals)).toEqual([]);
  expect(withInteractiveFallback(legacy, "history").visuals).toContain("timeline — Atoms and molecules");
  const planned = { title: "X", visuals: ["timeline — dates"] };
  expect(withInteractiveFallback(planned, "science")).toBe(planned);
  const opted = { title: "X", visuals: ["no interactive visual: a purely textual reading list chapter"] };
  expect(withInteractiveFallback(opted)).toBe(opted);
});
