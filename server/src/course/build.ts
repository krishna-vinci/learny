import type { CourseView } from "@studium/shared";
import { PlanFrontmatter, parseFrontmatter } from "@studium/shared";
import { slugify } from "../ingest/ids.js";
import { coverageKey, loadCoverage } from "../search/coverage.js";
import { chapterExists, parseCurriculum } from "../tree/curriculum.js";
import { readText } from "../tree/edit.js";
import { readMediaBrief, realisedVisuals } from "../tree/media-brief.js";
import { resolveInRoot } from "../tree/paths.js";
import { isSetSlug, listNotes } from "../tree/read.js";

export interface ActiveChapterJob {
  id: string;
  kind: "draft-chapter" | "rewrite-chapter";
  title: string;
  path?: string;
}

export async function buildCourse(
  root: string,
  set: string,
  jobs: readonly ActiveChapterJob[] = [],
): Promise<CourseView> {
  if (!isSetSlug(set)) throw new Error("invalid set");
  const plan = await readText(root, `${set}/PLAN.md`);
  let curriculum = "";
  try {
    curriculum = await readText(root, `${set}/curriculum.md`);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "not_found")) throw error;
  }
  // Check confinement even when the notes directory is a symlink.
  resolveInRoot(root, `${set}/notes`);
  const notes = await listNotes(root, set);
  let subject: CourseView["subject"] = "general";
  try {
    subject = PlanFrontmatter.shape.subject.parse(parseFrontmatter(plan).frontmatter.subject) ?? "general";
  } catch {
    // Broken user-edited YAML must not hide the curriculum.
  }
  const coverage = await loadCoverage(root);
  const chapters = (
    await Promise.all(
      parseCurriculum(curriculum).map(async (chapter, index) => {
        const note = notes.find((candidate) => chapterExists(chapter, [candidate]));
        const job = jobs.find((candidate) =>
          candidate.kind === "rewrite-chapter"
            ? candidate.path === note?.path
            : slugify(candidate.title, 40) === slugify(chapter.title, 40),
        );
        const saved = await readMediaBrief(root, set, chapter);
        const brief =
          saved &&
          saved.scope === chapter.scope &&
          saved.video.intent === chapter.video &&
          JSON.stringify(saved.visuals.map((v) => v.intent)) === JSON.stringify(chapter.visuals)
            ? saved
            : null;
        const media = {
          visuals:
            brief && note
              ? await realisedVisuals(
                  root,
                  `${set}/${note.path}`,
                  await readText(root, `${set}/${note.path}`),
                  brief.visuals,
                )
              : chapter.visuals.map((intent) => ({ intent, made: false })),
          video: brief?.video ?? { intent: chapter.video, status: "planned" as const },
        };
        return {
          order: chapter.number ?? index + 1,
          title: chapter.title,
          scope: chapter.scope,
          media,
          ...(coverage.has(coverageKey(set, chapter.title, chapter.scope))
            ? { evidence: coverage.get(coverageKey(set, chapter.title, chapter.scope)) }
            : {}),
          prerequisites: chapter.prerequisites,
          state: job
            ? ("drafting" as const)
            : note
              ? note.status === "accepted"
                ? ("accepted" as const)
                : note.status === "checked"
                  ? ("checked" as const)
                  : ("drafted" as const)
              : ("planned" as const),
          ...(note ? { path: note.path } : {}),
          ...(job ? { jobId: job.id } : {}),
        };
      }),
    )
  ).sort((a, b) => a.order - b.order);
  const planned = parseCurriculum(curriculum);
  const otherNotes = notes.filter((note) => !planned.some((chapter) => chapterExists(chapter, [note])));
  return { subject, chapters, otherNotes };
}
