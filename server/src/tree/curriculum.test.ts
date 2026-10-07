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

it("round-trips the real polymers curriculum byte-for-byte, preserving ticks and unknown fenced lines", async () => {
  const { readFile } = await import("node:fs/promises");
  const { serializeCurriculum } = await import("./curriculum.js");
  const real = await readFile(new URL("./fixtures/polymers-curriculum.md", import.meta.url), "utf8");
  expect(serializeCurriculum(parseCurriculum(real), real)).toBe(real);
  const custom = `${real}\n<!-- keep me -->\n\`\`\`md\n  Scope: example, not chapter metadata\n- [x] 99 — Example\n\`\`\`\n`;
  expect(serializeCurriculum(parseCurriculum(custom), custom)).toBe(custom);
  const crlf = custom.replace(/\n/g, "\r\n");
  expect(serializeCurriculum(parseCurriculum(crlf), crlf)).toBe(crlf);
});

it("updates fields without losing unknown lines, images or ticks", async () => {
  const { applyCurriculumOperation, serializeCurriculum } = await import("./curriculum.js");
  const text =
    "# Curriculum\n- [x] 01 — First\n  Scope: Basics\n  Prerequisites: none\n  Image: Keep this photo\n  Unknown: Keep this too\n  Visual: figure — Old\n  Video: Old video\n\n```md\n  Scope: Example\n```\n";
  const chapters = applyCurriculumOperation(text, {
    operation: "update",
    number: 1,
    chapter: {
      title: "Renamed",
      scope: "New scope",
      prerequisites: "none",
      visuals: ["step-through — Try it"],
      video: "New video",
    },
  });
  const result = serializeCurriculum(chapters, text);
  expect(result).toContain("- [x] 01 — Renamed");
  expect(result).toContain("  Unknown: Keep this too");
  expect(result).toContain("  Image: Keep this photo");
  expect(result).toContain("```md\n  Scope: Example\n```");
  expect(parseCurriculum(result)[0]).toMatchObject({
    scope: "New scope",
    visuals: ["step-through — Try it"],
    video: "New video",
  });
});

it("inserts, moves and deletes while renumbering prerequisites to follow chapter identity", async () => {
  const { applyCurriculumOperation, serializeCurriculum } = await import("./curriculum.js");
  const text =
    "- [x] 01 — A\n  Scope: A\n  Prerequisites: none\n- [ ] 02 — B\n  Scope: B\n  Prerequisites: 01\n- [ ] 03 — C\n  Scope: C\n  Prerequisites: 01\n- [ ] 04 — D\n  Scope: D\n  Prerequisites: 02, 03\n";
  const moved = applyCurriculumOperation(text, { operation: "move", number: 3, direction: "up" });
  expect(moved.map((c) => [c.number, c.title, c.prerequisites])).toEqual([
    [1, "A", "none"],
    [2, "C", "01"],
    [3, "B", "01"],
    [4, "D", "03, 02"],
  ]);
  const inserted = applyCurriculumOperation(text, {
    operation: "insert",
    after: 1,
    chapter: { title: "New", scope: "New scope", prerequisites: "01", visuals: [], video: "" },
  });
  expect(parseCurriculum(serializeCurriculum(inserted, text)).map((c) => c.number)).toEqual([1, 2, 3, 4, 5]);
  expect(inserted.at(-1)?.prerequisites).toBe("03, 04");
  expect(applyCurriculumOperation(text, { operation: "delete", number: 2 }).at(-1)?.prerequisites).toBe("02");
  expect(
    applyCurriculumOperation(text, {
      operation: "insert",
      after: null,
      chapter: { title: "End", scope: "End", prerequisites: "04", visuals: [], video: "" },
    }).at(-1)?.number,
  ).toBe(5);
});

it("rejects self, forward, unknown, duplicate prerequisites and illegal moves", async () => {
  const { applyCurriculumOperation } = await import("./curriculum.js");
  const text = "- [ ] 01 — A\n  Scope: A\n  Prerequisites: none\n- [ ] 02 — B\n  Scope: B\n  Prerequisites: 01\n";
  for (const prerequisites of ["02", "99", "01, 01", "2", "01 and 02"])
    expect(() =>
      applyCurriculumOperation(text, {
        operation: "update",
        number: 2,
        chapter: { title: "B", scope: "B", prerequisites, visuals: [], video: "" },
      }),
    ).toThrow();
  expect(() => applyCurriculumOperation(text, { operation: "move", number: 2, direction: "up" })).toThrow(
    "prerequisites",
  );
});

it("preserves unknown text on deletion and leaves untouched prerequisite formatting intact", async () => {
  const { applyCurriculumOperation, serializeCurriculum } = await import("./curriculum.js");
  const text =
    "- [ ] 01 — A\n  Scope: A\n  Prerequisites: none\n  Custom: preserve this\n- [ ] 02 — B\n  Scope: B\n  Prerequisites: none\n- [ ] 03 — C\n  Scope: C\n  Prerequisites: 01,02\n";
  const updated = applyCurriculumOperation(text, {
    operation: "update",
    number: 1,
    chapter: { title: "Renamed", scope: "A", prerequisites: "none", visuals: [], video: "" },
  });
  expect(serializeCurriculum(updated, text)).toContain("  Prerequisites: 01,02");
  expect(serializeCurriculum(applyCurriculumOperation(text, { operation: "delete", number: 1 }), text)).toContain(
    "  Custom: preserve this",
  );
});
