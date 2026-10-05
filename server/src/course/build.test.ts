import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it } from "vitest";
import { saveCoverage } from "../search/coverage.js";
import { buildCourse } from "./build.js";

let root: string;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-course-"));
  await fs.mkdir(path.join(root, "history/notes"), { recursive: true });
  await fs.writeFile(path.join(root, "history/PLAN.md"), "---\nsubject: history\n---\n");
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});
it("exposes measured evidence on the matching chapter without changing curriculum", async () => {
  const curriculum = "- [ ] 01 — Polymers\n  Scope: Cross-linking and glass transition.\n";
  await fs.writeFile(path.join(root, "history/curriculum.md"), curriculum);
  const evidence = {
    covered: 1,
    total: 2,
    weakest: ["glass transition"],
    concepts: ["Cross-linking", "glass transition"],
    measuredAt: "2026-10-04T00:00:00.000Z",
  };
  await saveCoverage(root, "history", "Polymers", "Cross-linking and glass transition.", evidence);
  expect((await buildCourse(root, "history")).chapters[0]?.evidence).toEqual(evidence);
  expect(await fs.readFile(path.join(root, "history/curriculum.md"), "utf8")).toBe(curriculum);
});
it("derives states from notes and active jobs regardless of ticks, without mutating the course", async () => {
  const curriculum =
    "- [x] 01 — Missing\n- [ ] 02 — Existing draft\n  Scope: A city and its people.\n  Prerequisites: 01\n- [ ] 03 — Checked\n- [ ] 04 — Accepted\n- [ ] 05 — Working\n";
  await fs.writeFile(path.join(root, "history/curriculum.md"), curriculum);
  for (const [n, status] of [
    [2, "draft"],
    [3, "checked"],
    [4, "accepted"],
  ]) {
    await fs.writeFile(path.join(root, `history/notes/0${n}-note.md`), `---\nstatus: ${status}\n---\n`);
  }
  const course = await buildCourse(root, "history", [{ id: "job", kind: "draft-chapter", title: "Working" }]);
  expect(course.subject).toBe("history");
  expect(course.chapters.map((c) => c.state)).toEqual(["planned", "drafted", "checked", "accepted", "drafting"]);
  expect(course.chapters[1]).toMatchObject({
    order: 2,
    scope: "A city and its people.",
    prerequisites: "01",
    path: "notes/02-note.md",
  });
  expect(course.chapters[4]).toMatchObject({ jobId: "job" });
  expect(await fs.readFile(path.join(root, "history/curriculum.md"), "utf8")).toBe(curriculum);
  expect(
    (
      await buildCourse(root, "history", [
        { id: "rewrite", kind: "rewrite-chapter", title: "Rewriting chapter", path: "notes/04-note.md" },
      ])
    ).chapters[3],
  ).toMatchObject({ state: "drafting", path: "notes/04-note.md", jobId: "rewrite" });
});
it("matches existing title slugs and falls back to general for unknown or absent subjects", async () => {
  await fs.writeFile(path.join(root, "history/curriculum.md"), "- [ ] 03 — Old city\n");
  await fs.writeFile(path.join(root, "history/notes/09-old-city.md"), "---\nstatus: checked\n---\n");
  for (const plan of ["---\nsubject: unknown\n---\n", "# Legacy plan"]) {
    await fs.writeFile(path.join(root, "history/PLAN.md"), plan);
    expect(await buildCourse(root, "history")).toMatchObject({
      subject: "general",
      chapters: [{ state: "checked", path: "notes/09-old-city.md" }],
    });
  }
  await fs.unlink(path.join(root, "history/curriculum.md"));
  expect((await buildCourse(root, "history")).chapters).toEqual([]);
});
it("reads per-chapter media intent and retains legacy chapters and fenced examples", async () => {
  const curriculum =
    "```md\n- [ ] 99 — Example\n  Visual: chart — hidden\n```\n- [ ] 01 — City\n  Visual: timeline — Founding\n  Visual: diagram — Trade routes\n  Video: A historian explaining the founding\n- [ ] 02 — Legacy\n";
  await fs.writeFile(path.join(root, "history/curriculum.md"), curriculum);
  const course = await buildCourse(root, "history");
  expect(course.chapters).toHaveLength(2);
  expect(course.chapters[0]?.media).toEqual({
    visuals: [
      { intent: "timeline — Founding", made: false },
      { intent: "diagram — Trade routes", made: false },
    ],
    video: { intent: "A historian explaining the founding", status: "planned" },
  });
  expect(course.chapters[1]?.media?.visuals).toEqual([]);
});
