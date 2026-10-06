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
