import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFrontmatter } from "@studium/shared";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildCourse } from "../course/build.js";
import { editCurriculum } from "./curriculum-edit.js";
import * as edits from "./edit.js";
import { commitAll, ensureRepo, log, revert } from "./git.js";
import { FileLocks } from "./lock.js";
import { mediaBriefPath } from "./media-brief.js";

let root: string;
let locks: FileLocks;
const text =
  "- [x] 01 — Atoms\n  Scope: Atom scope\n  Prerequisites: none\n  Visual: step-through — Bonds\n  Video: Bonds\n- [ ] 02 — Molecules\n  Scope: Molecule scope\n  Prerequisites: none\n";
const brief = {
  chapter: "Atoms",
  scope: "Atom scope",
  refinedAt: "2026-10-01",
  figures: [],
  tables: [],
  visuals: [{ id: "visual-1", intent: "step-through — Bonds" }],
  video: { intent: "Bonds", status: "none", reason: "No suitable video" },
};
const note =
  "---\ntitle: Atoms\nchapter: atoms\norder: 1\nstatus: accepted\n# Preserve this comment\nextra: keep\n---\n\nOriginal note body\n";
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "m17-edit-"));
  locks = new FileLocks();
  await fs.mkdir(path.join(root, "course/notes"), { recursive: true });
  await fs.mkdir(path.join(root, "course/media"));
  await fs.writeFile(path.join(root, "course/PLAN.md"), "---\ntitle: Course\n---\n");
  await fs.writeFile(path.join(root, "course/curriculum.md"), text);
  await fs.writeFile(path.join(root, "course/notes/01-atoms.md"), note);
  await fs.writeFile(path.join(root, "course/media/01-atoms.md"), `---\n${JSON.stringify(brief)}\n---\n`);
  await fs.writeFile(path.join(root, "course/media/01-atoms.evidence.json"), '{"keep":true}');
  await ensureRepo(root);
  await commitAll(root, "fixture", "system");
});
afterEach(async () => {
  vi.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});

it("renames a linked note under its lock, carries media, makes brief stale and undoes all linked changes", async () => {
  const result = await editCurriculum(root, locks, "course", {
    previous: text,
    operation: "update",
    number: 1,
    chapter: {
      title: "Atomic bonds",
      scope: "Atom scope",
      prerequisites: "none",
      visuals: ["step-through — Bonds"],
      video: "Bonds",
    },
  });
  const changed = await fs.readFile(path.join(root, "course/notes/01-atoms.md"), "utf8");
  expect(parseFrontmatter(changed).frontmatter).toMatchObject({ chapter: "atomic-bonds", order: 1, extra: "keep" });
  expect(changed).toContain("# Preserve this comment");
  expect(changed).toContain("Original note body");
  expect(await fs.readFile(path.join(root, "course/media/01-atomic-bonds.evidence.json"), "utf8")).toBe(
    '{"keep":true}',
  );
  expect((await buildCourse(root, "course")).chapters[0]).toMatchObject({
    title: "Atomic bonds",
    path: "notes/01-atoms.md",
    media: { video: { status: "planned" } },
  });
  expect((await log(root, { limit: 1 }))[0]?.author).toBe("user");
  await revert(root, result.sha as string, "user");
  expect(await fs.readFile(path.join(root, "course/curriculum.md"), "utf8")).toBe(text);
  expect(await fs.readFile(path.join(root, "course/notes/01-atoms.md"), "utf8")).toBe(note);
});

it("moves linked notes and media and inserts while keeping displayed chapter numbers", async () => {
  await editCurriculum(root, locks, "course", { previous: text, operation: "move", number: 2, direction: "up" });
  const course = await buildCourse(root, "course");
  expect(course.chapters[1]).toMatchObject({
    order: 2,
    path: "notes/01-atoms.md",
    media: { video: { status: "none" } },
  });
  expect(await fs.readFile(path.join(root, mediaBriefPath("course", { number: 2, title: "Atoms" })), "utf8")).toContain(
    "Atoms",
  );
  const previous = await fs.readFile(path.join(root, "course/curriculum.md"), "utf8");
  await editCurriculum(root, locks, "course", {
    previous,
    operation: "insert",
    after: 1,
    chapter: { title: "New chapter", scope: "New", prerequisites: "01", visuals: [], video: "" },
  });
  expect((await buildCourse(root, "course")).chapters[2]).toMatchObject({ order: 3, path: "notes/01-atoms.md" });
});

it("deletes a chapter while retaining the note as an other note, and rejects stale edits", async () => {
  await editCurriculum(root, locks, "course", { previous: text, operation: "delete", number: 1 });
  const course = await buildCourse(root, "course");
  expect(course.otherNotes).toHaveLength(1);
  expect(course.otherNotes?.[0]?.number).toBeUndefined();
  expect(await fs.readFile(path.join(root, "course/notes/01-atoms.md"), "utf8")).toContain("Original note body");
  await expect(
    editCurriculum(root, locks, "course", { previous: text, operation: "delete", number: 2 }),
  ).rejects.toMatchObject({ code: "conflict" });
});

it("invalidates a brief when scope or media intent changes", async () => {
  await editCurriculum(root, locks, "course", {
    previous: text,
    operation: "update",
    number: 1,
    chapter: {
      title: "Atoms",
      scope: "Updated scope",
      prerequisites: "none",
      visuals: ["step-through — New bonds"],
      video: "Different video",
    },
  });
  expect((await buildCourse(root, "course")).chapters[0]?.media?.video.status).toBe("planned");
});

it("rejects symlink aliases and rolls back a linked write failure", async () => {
  const write = edits.writeTextLocked;
  let failed = false;
  vi.spyOn(edits, "writeTextLocked").mockImplementation(async (...args) => {
    if (!failed && args[3].includes("notes/")) {
      failed = true;
      throw new Error("injected write failure");
    }
    return write(...args);
  });
  await expect(
    editCurriculum(root, locks, "course", { previous: text, operation: "delete", number: 1 }),
  ).rejects.toThrow("injected");
  expect(await fs.readFile(path.join(root, "course/curriculum.md"), "utf8")).toBe(text);
  expect(await fs.readFile(path.join(root, "course/notes/01-atoms.md"), "utf8")).toBe(note);
  vi.restoreAllMocks();
  await fs.rename(path.join(root, "course/curriculum.md"), path.join(root, "course/other.md"));
  await fs.symlink("other.md", path.join(root, "course/curriculum.md"));
  await expect(
    editCurriculum(root, locks, "course", { previous: text, operation: "delete", number: 1 }),
  ).rejects.toThrow("symlinks");
});
