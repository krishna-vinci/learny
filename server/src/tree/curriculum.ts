import path from "node:path";
import { slugify } from "../ingest/ids.js";

export interface CurriculumChapter {
  label: string;
  title: string;
  number: number | null;
  checked: boolean;
  scope: string;
  prerequisites: string;
  visuals: string[];
  video: string;
  line: number;
}

/** Ignore fenced examples and retain line indices for exact checkbox edits. */
export function parseCurriculum(text: string | null): CurriculumChapter[] {
  const chapters: CurriculumChapter[] = [];
  let fence: { marker: string; length: number } | null = null;
  let current: CurriculumChapter | undefined;
  for (const [index, line] of (text ?? "").split(/\r?\n/).entries()) {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker?.[1] !== undefined) {
      if (fence === null) fence = { marker: marker[1][0] ?? "", length: marker[1].length };
      else if (marker[1][0] === fence.marker && marker[1].length >= fence.length && marker[2]?.trim() === "")
        fence = null;
      continue;
    }
    if (fence !== null) continue;
    const match = /^\s*(?:[-+*]|\d+[.)])\s+\[([ xX])\]\s+(.+)$/.exec(line);
    if (match?.[2]?.trim()) {
      const label = match[2].trim();
      const numbered = /^(\d{2,})\s+[—–-]\s+(.+)$/.exec(label);
      current = {
        label,
        title: numbered?.[2]?.trim() ?? label,
        number: numbered?.[1] === undefined ? null : Number(numbered[1]),
        checked: match[1] !== " ",
        scope: "",
        prerequisites: "",
        visuals: [],
        video: "",
        line: index,
      };
      chapters.push(current);
    } else if (current !== undefined) {
      const scope = /^\s+(?:[-*]\s+)?Scope:\s*(.+)$/i.exec(line)?.[1]?.trim();
      const prerequisites = /^\s+(?:[-*]\s+)?Prerequisites:\s*(.+)$/i.exec(line)?.[1]?.trim();
      const visual = /^\s+(?:[-*]\s+)?Visual:\s*(.+)$/i.exec(line)?.[1]?.trim();
      const video = /^\s+(?:[-*]\s+)?Video:\s*(.+)$/i.exec(line)?.[1]?.trim();
      if (visual) current.visuals.push(visual);
      if (video) current.video = video;
      if (scope) current.scope = scope;
      if (prerequisites) current.prerequisites = prerequisites;
    }
  }
  return chapters;
}

export interface ChapterNote {
  path: string;
  title?: string;
  chapter?: string;
}

/** Explicit identity wins; legacy notes match by title or filename slug, never number. */
export function chapterExists(chapter: CurriculumChapter, notes: readonly (ChapterNote | string)[]): boolean {
  const titleSlug = slugify(chapter.title, 40);
  if (!titleSlug) return false;
  return notes.some((candidate) => {
    const note = typeof candidate === "string" ? { path: candidate } : candidate;
    if (note.chapter?.trim()) return note.chapter === titleSlug;
    const basename = path.posix.basename(note.path, ".md");
    const filenameSlug = basename.replace(/^\d+-/, "");
    return filenameSlug === titleSlug || (note.title !== undefined && slugify(note.title, 40) === titleSlug);
  });
}
