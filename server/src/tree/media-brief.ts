import { promises as fs } from "node:fs";
import path from "node:path";
import type { ChapterMedia } from "@studium/shared";
import { parseFrontmatter } from "@studium/shared";
import { mediaAttributes, resolveNoteMedia } from "@studium/shared/media";
import { stringify } from "yaml";
import { z } from "zod";
import { slugify } from "../ingest/ids.js";
import { type CurriculumChapter, chapterExists, parseCurriculum } from "./curriculum.js";
import { readText, writeTextLocked } from "./edit.js";
import { commitPaths } from "./git.js";
import type { FileLocks } from "./lock.js";
import { canonicalRel, resolveInRoot } from "./paths.js";
import { readSetFile } from "./read.js";

const Figure = z.object({
  sourceId: z.string(),
  path: z.string().optional(),
  url: z.string(),
  alt: z.string(),
  caption: z.string(),
  section: z.string(),
  license: z.string().optional(),
  credit: z.string(),
});
const Table = z.object({ sourceId: z.string(), file: z.string(), anchor: z.string(), text: z.string() });
export const MediaBriefSchema = z.object({
  chapter: z.string(),
  scope: z.string(),
  refinedAt: z.string(),
  visuals: z.array(z.object({ id: z.string().regex(/^visual-\d+$/), intent: z.string() })).max(20),
  figures: z.array(Figure).max(24),
  tables: z.array(Table).max(8),
  video: z.object({
    intent: z.string(),
    status: z.enum(["chosen", "none"]),
    reason: z.string().optional(),
    sourceId: z.string().optional(),
    title: z.string().optional(),
    channel: z.string().optional(),
    url: z.string().optional(),
    moment: z.string().optional(),
    anchor: z.string().optional(),
    watchOnly: z.boolean().optional(),
  }),
});
export type MediaBrief = z.infer<typeof MediaBriefSchema>;
export function mediaBriefPath(set: string, chapter: Pick<CurriculumChapter, "title" | "number">): string {
  return `${set}/media/${String(chapter.number ?? 0).padStart(2, "0")}-${slugify(chapter.title, 40) || "chapter"}.md`;
}
export async function readMediaBrief(
  root: string,
  set: string,
  chapter: Pick<CurriculumChapter, "title" | "number">,
): Promise<MediaBrief | null> {
  const rel = mediaBriefPath(set, chapter);
  if (canonicalRel(root, rel) !== rel) throw new Error("Media brief paths may not be symlink aliases");
  try {
    const text = await readText(root, rel);
    if (Buffer.byteLength(text) > 100000) return null;
    const parsed = MediaBriefSchema.safeParse(parseFrontmatter(text).frontmatter);
    return parsed.success && parsed.data.chapter === chapter.title ? parsed.data : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "not_found") return null;
    throw error;
  }
}
export async function saveMediaBrief(
  root: string,
  locks: FileLocks,
  set: string,
  chapter: CurriculumChapter,
  brief: MediaBrief,
): Promise<void> {
  const rel = mediaBriefPath(set, chapter);
  const holder = `outliner:media:${crypto.randomUUID()}`;
  await locks.withLock(rel, holder, async () => {
    if (canonicalRel(root, rel) !== rel) throw new Error("Media brief paths may not be symlink aliases");
    const valid = MediaBriefSchema.parse(brief);
    await fs.mkdir(path.dirname(resolveInRoot(root, rel)), { recursive: true });
    await writeTextLocked(
      root,
      locks,
      holder,
      rel,
      `---\n${stringify(valid, { lineWidth: 0 })}---\n\n# Media for ${chapter.title}\n\n${valid.visuals.map((v) => `- ${v.id}: ${v.intent}`).join("\n")}\n\n${valid.video.status === "chosen" ? `Video: ${valid.video.title} — ${valid.video.url}${valid.video.moment ? ` (${valid.video.moment})` : ""}` : `No suitable video: ${valid.video.reason}`}\n`,
      (p) => p === rel,
    );
    await commitPaths(root, [rel], `outliner: media for ${chapter.title}`, "outliner");
  });
}

/** Markers associate a planned concept with an actual figure, chart or interactive file. */
export async function realisedVisuals(
  root: string,
  notePath: string,
  text: string,
  visuals: MediaBrief["visuals"],
): Promise<ChapterMedia["visuals"]> {
  // Remove fenced examples, but keep actual diagram/chart fences as one media line.
  let fence = "";
  const lines: string[] = [];
  for (const line of parseFrontmatter(text).body.split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) {
      if (marker?.[1] && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2]?.trim())
        fence = "";
      continue;
    }
    if (marker?.[1]) {
      fence = marker[1];
      if (/^(?:mermaid|vega-lite)\s*$/.test(marker[2] ?? "")) lines.push(line);
      continue;
    }
    lines.push(line);
  }
  return Promise.all(
    visuals.map(async (visual) => {
      const index = lines.findIndex((line) => line.trim() === `<!-- media:${visual.id} -->`);
      const following =
        index < 0
          ? ""
          : (lines
              .slice(index + 1)
              .find((line) => line.trim())
              ?.trim() ?? "");
      const directive = /^::(?:visual|artifact)\{(.*)\}$/.exec(following);
      const src =
        /^!\[[^\]]*\]\(<?([^\s)>]+)>?/.exec(following)?.[1] ??
        (directive ? mediaAttributes(directive[1] ?? "")?.src : undefined);
      let made = /^(?:`{3,}|~{3,})(?:mermaid|vega-lite)\s*$/.test(following);
      if (src) {
        const kind = following.startsWith("::visual")
          ? "visual"
          : following.startsWith("::artifact")
            ? "html"
            : "image";
        const media = resolveNoteMedia(notePath, src, kind);
        if (media) {
          const rel = `${media.set}/${media.path}`;
          made =
            canonicalRel(root, rel) === rel &&
            (await fs.stat(resolveInRoot(root, rel)).catch(() => null))?.isFile() === true;
        }
      }
      const reasonLine = lines.find((line) => line.startsWith(`<!-- media:${visual.id} unavailable: `));
      const reasonIndex = reasonLine ? lines.indexOf(reasonLine) : -1;
      const explanation =
        reasonIndex < 0
          ? ""
          : (lines
              .slice(reasonIndex + 1)
              .find((line) => line.trim())
              ?.trim() ?? "");
      const reason = reasonLine
        ?.replace(`<!-- media:${visual.id} unavailable: `, "")
        .replace(/\s*-->$/, "")
        .trim();
      return {
        intent: visual.intent,
        made,
        ...(made && src ? { path: src } : {}),
        ...(reason && /^\*[^*]+\*|^_[^_]+_/.test(explanation)
          ? { reason: explanation.replace(/^([*_])([^*_]+)\1/, "$2") }
          : {}),
      };
    }),
  );
}
export async function mediaPlanBlockers(
  root: string,
  notePath: string,
  text: string,
  brief: MediaBrief | null,
): Promise<string[]> {
  if (!brief) return [];
  const visuals = await realisedVisuals(root, notePath, text, brief.visuals);
  return visuals
    .filter((v) => !v.made && !v.reason)
    .map((v) => `Planned visual is missing without an explanation: ${v.intent}`);
}

export async function noteMediaBrief(root: string, notePath: string): Promise<MediaBrief | null> {
  const [set] = notePath.split("/");
  if (!set) return null;
  let curriculum: string;
  try {
    curriculum = await readText(root, `${set}/curriculum.md`);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "not_found") return null;
    throw error;
  }
  const note = await readSetFile(root, set, notePath.slice(set.length + 1));
  const chapter = parseCurriculum(curriculum).find((c) =>
    chapterExists(c, [
      {
        path: notePath,
        title: typeof note?.frontmatter.title === "string" ? note.frontmatter.title : undefined,
        chapter: typeof note?.frontmatter.chapter === "string" ? note.frontmatter.chapter : undefined,
      },
    ]),
  );
  if (!chapter) return null;
  const saved = await readMediaBrief(root, set, chapter);
  if (
    saved &&
    saved.scope === chapter.scope &&
    JSON.stringify(saved.visuals.map((v) => v.intent)) === JSON.stringify(chapter.visuals)
  )
    return saved;
  if (!chapter.visuals.length) return null;
  // Missing/stale refinement must not bypass the curriculum's visual requirements.
  return {
    chapter: chapter.title,
    scope: chapter.scope,
    refinedAt: "",
    visuals: chapter.visuals.map((intent, i) => ({ id: `visual-${i + 1}`, intent })),
    figures: [],
    tables: [],
    video: { intent: chapter.video, status: "none", reason: "Media sources have not been refined yet." },
  };
}
