import path from "node:path";
import type { CurriculumOperation, PlanProposalChapter } from "@studium/shared";
import { slugify } from "../ingest/ids.js";

export interface CurriculumChapter {
  label: string;
  title: string;
  number: number | null;
  checked: boolean;
  scope: string;
  prerequisites: string;
  visuals: string[];
  images?: string[];
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
        images: [],
        video: "",
        line: index,
      };
      chapters.push(current);
    } else if (current !== undefined) {
      const scope = /^\s+(?:[-*]\s+)?Scope:\s*(.+)$/i.exec(line)?.[1]?.trim();
      const prerequisites = /^\s+(?:[-*]\s+)?Prerequisites:\s*(.+)$/i.exec(line)?.[1]?.trim();
      const visual = /^\s+(?:[-*]\s+)?Visual:\s*(.+)$/i.exec(line)?.[1]?.trim();
      const video = /^\s+(?:[-*]\s+)?Video:\s*(.+)$/i.exec(line)?.[1]?.trim();
      const image = /^\s+(?:[-*]\s+)?Image:\s*(.+)$/i.exec(line)?.[1]?.trim();
      if (image) current.images?.push(image);
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

/** Forms backed by the D32 catalog; static charts/figures cannot meet this contract. */
export function interactiveIntent(intent: string): { form: string; concept: string } | null {
  const match =
    /^(function-plot(?: widget)?|matrix-transform(?: widget)?|step-through(?: widget)?|timeline(?: widget)?|(?:svg |p5 |d3 )?sketch|(?:svg )?story)\s*[—–]\s*(\S.*)$/i.exec(
      intent.trim(),
    );
  return match?.[1] && match[2] ? { form: match[1].toLowerCase(), concept: match[2].trim() } : null;
}

export function noInteractiveReason(visuals: readonly string[]): string | undefined {
  return visuals.map((v) => /^no interactive visual:\s*(.{12,})$/i.exec(v.trim())?.[1]?.trim()).find(Boolean);
}

/** Chapters planned before the interactive-visual rule (D36/M14b) have no interactive intent.
 * Instead of refusing to draft them, add a catalog-backed default the brief and drafter refine. */
export function withInteractiveFallback<T extends { title: string; visuals: string[] }>(
  chapter: T,
  subject?: string,
): T {
  const visuals = chapter.visuals;
  if (visuals.some((v) => interactiveIntent(v)) || noInteractiveReason(visuals)) return chapter;
  const form =
    subject === "history" || subject === "politics"
      ? "timeline"
      : subject === "math" || subject === "economics" || subject === "finance"
        ? "function-plot"
        : "step-through";
  return { ...chapter, visuals: [...visuals, `${form} — ${chapter.title}`] };
}

export function interactivePlanIssues(visuals: readonly string[]): string[] {
  const count = visuals.filter((v) => interactiveIntent(v)).length;
  if (count > 2) return ["Plan at most two interactive visuals per chapter"];
  if (!count && !noInteractiveReason(visuals))
    return [
      "Plan at least one interactive Visual intent with form and concept, or no interactive visual: <concrete reason>",
    ];
  if (count && noInteractiveReason(visuals))
    return ["Interactive intents conflict with the no interactive visual reason"];
  return [];
}

const FIELD_LINE = /^(\s+(?:[-*]\s+)?)(Scope|Prerequisites|Visual|Video|Image):\s*(.+)$/i;

/** Recognised fields only, outside fences, indexed relative to a chapter block. */
function fieldLines(lines: string[]): Map<number, string> {
  const fields = new Map<number, string>();
  let fence: string | undefined;
  for (const [i, line] of lines.entries()) {
    const marker = /^\s*(`{3,}|~{3,})(.*)$/.exec(line);
    if (marker?.[1]) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2]?.trim()) fence = undefined;
      continue;
    }
    const match = !fence && FIELD_LINE.exec(line);
    if (match) fields.set(i, match[2]?.toLowerCase() ?? "");
  }
  return fields;
}

/** Serialise against the original text. Source line identities retain unknown lines,
 * fenced examples, images, comments, spacing, and untouched bytes (including CRLF). */
export function serializeCurriculum(chapters: readonly CurriculumChapter[], original = ""): string {
  const old = parseCurriculum(original);
  const eol = original.includes("\r\n") ? "\r\n" : "\n";
  const lines = original.split(/\r?\n/);
  const prefix = old.length ? lines.slice(0, old[0]?.line) : original ? lines : [];
  const blocks = new Map(old.map((c, i) => [c.line, lines.slice(c.line, old[i + 1]?.line ?? lines.length)]));
  const result = [...prefix];
  for (const chapter of chapters) {
    const before = old.find((c) => c.line === chapter.line);
    const block = before ? [...(blocks.get(before.line) ?? [])] : [];
    const fields = fieldLines(block);
    const values = {
      scope: chapter.scope ? [chapter.scope] : [],
      prerequisites: chapter.prerequisites ? [chapter.prerequisites] : [],
      visual: chapter.visuals,
      image: chapter.images ?? [],
      video: chapter.video ? [chapter.video] : [],
    };
    const changed = new Set(
      Object.keys(values).filter((key) => {
        if (!before) return true;
        const previous =
          key === "visual"
            ? before.visuals
            : key === "image"
              ? (before.images ?? [])
              : [before[key as "scope" | "prerequisites" | "video"]].filter(Boolean);
        return JSON.stringify(previous) !== JSON.stringify(values[key as keyof typeof values]);
      }),
    );
    const label =
      chapter.number === null ? chapter.title : `${String(chapter.number).padStart(2, "0")} — ${chapter.title}`;
    const headerChanged =
      !before ||
      chapter.number !== before.number ||
      chapter.title !== before.title ||
      chapter.checked !== before.checked;
    const header = headerChanged ? `- [${chapter.checked ? "x" : " "}] ${label}` : (block[0] ?? "");
    const emitted = new Set<string>();
    const output = [header];
    const emit = (key: string, indent = "  ") => {
      for (const value of values[key as keyof typeof values])
        output.push(`${indent}${key === "visual" ? "Visual" : key[0]?.toUpperCase() + key.slice(1)}: ${value}`);
      emitted.add(key);
    };
    for (const [i, line] of block.entries()) {
      if (!i) continue;
      const key = fields.get(i);
      if (key && changed.has(key)) {
        if (!emitted.has(key)) emit(key, FIELD_LINE.exec(line)?.[1]);
      } else output.push(line);
    }
    const trailing: string[] = [];
    while (output.length > 1 && output.at(-1) === "") trailing.unshift(output.pop() ?? "");
    for (const key of changed) if (!emitted.has(key)) emit(key);
    result.push(...output, ...trailing);
    if (!before && result.at(-1) !== "") result.push("");
  }
  // Removing a chapter never discards content the parser does not understand.
  for (const chapter of old) {
    if (chapters.some((c) => c.line === chapter.line)) continue;
    const block = blocks.get(chapter.line) ?? [];
    const fields = fieldLines(block);
    result.push(...block.filter((_, i) => i > 0 && !fields.has(i)));
  }
  const text = result.join(eol);
  const shape = (chapter: CurriculumChapter) => [
    chapter.number,
    chapter.title,
    chapter.checked,
    chapter.scope,
    chapter.prerequisites,
    chapter.visuals,
    chapter.images ?? [],
    chapter.video,
  ];
  if (JSON.stringify(parseCurriculum(text).map(shape)) !== JSON.stringify(chapters.map(shape)))
    throw new Error(
      "Cannot preserve this curriculum's fenced content while applying the edit. Close unfinished fences first.",
    );
  return text;
}

export function validatePrerequisites(chapters: readonly CurriculumChapter[]): void {
  for (const [index, chapter] of chapters.entries()) {
    if (chapter.number !== index + 1) throw new Error("Chapters must have consecutive numbers starting at 01");
    if (/^none$/i.test(chapter.prerequisites)) continue;
    if (!/^\d{2,}(?:\s*,\s*\d{2,})*$/.test(chapter.prerequisites))
      throw new Error("Prerequisites must be none or earlier chapter numbers separated by commas");
    const refs = chapter.prerequisites.split(",").map(Number);
    if (new Set(refs).size !== refs.length || refs.some((n) => n < 1 || n >= (chapter.number ?? 0)))
      throw new Error(
        `Chapter ${String(chapter.number).padStart(2, "0")}: prerequisites cannot be self, forward, unknown or duplicate references`,
      );
  }
}

export function applyCurriculumOperation(text: string, operation: CurriculumOperation): CurriculumChapter[] {
  const chapters = parseCurriculum(text).map((c) => ({ ...c, visuals: [...c.visuals] }));
  const before = [...chapters];
  const index = "number" in operation ? chapters.findIndex((c) => c.number === operation.number) : -1;
  if ("number" in operation && index < 0) throw new Error("Chapter not found; reload the plan");
  if (operation.operation === "update" || operation.operation === "insert") {
    const edit = operation.chapter;
    if (!edit.title.trim() || !edit.scope.trim()) throw new Error("Title and scope are required");
    if ([edit.title, edit.scope, edit.prerequisites, edit.video, ...edit.visuals].some((v) => /[\r\n]/.test(v)))
      throw new Error("Chapter fields must be single lines");
    const changed = {
      ...edit,
      title: edit.title.trim(),
      scope: edit.scope.trim(),
      prerequisites: edit.prerequisites.trim() || "none",
      visuals: edit.visuals.map((v) => v.trim()).filter(Boolean),
      video: edit.video.trim(),
    };
    if (operation.operation === "update") chapters[index] = { ...(chapters[index] as CurriculumChapter), ...changed };
    else {
      const afterIndex =
        operation.after === null ? chapters.length - 1 : chapters.findIndex((c) => c.number === operation.after);
      if (operation.after !== null && afterIndex < 0) throw new Error("Chapter not found; reload the plan");
      chapters.splice(afterIndex + 1, 0, {
        ...changed,
        label: changed.title,
        number: null,
        checked: false,
        line: -1,
        images: [],
      });
    }
  } else if (operation.operation === "delete") chapters.splice(index, 1);
  else {
    const target = index + (operation.direction === "up" ? -1 : 1);
    if (target < 0 || target >= chapters.length) throw new Error("Chapter cannot move further");
    const [chapter] = chapters.splice(index, 1);
    if (chapter) chapters.splice(target, 0, chapter);
  }
  const mapping = new Map(chapters.filter((c) => c.number !== null).map((c) => [c.number, chapters.indexOf(c) + 1]));
  const deleted = before.find((c) => !chapters.some((next) => next.line === c.line))?.number;
  for (const [i, chapter] of chapters.entries()) {
    if (!/^none$/i.test(chapter.prerequisites)) {
      const refs = chapter.prerequisites.split(",").map((v) => v.trim());
      if (refs.some((v) => !/^\d{2,}$/.test(v)))
        throw new Error("Prerequisites must be none or earlier chapter numbers separated by commas");
      const rewritten = refs
        .map(Number)
        .filter((n) => n !== deleted)
        .map((n) => {
          const mapped = mapping.get(n);
          if (mapped === undefined) throw new Error(`Unknown prerequisite ${n}`);
          return String(mapped).padStart(2, "0");
        });
      if (JSON.stringify(refs.map(Number)) !== JSON.stringify(rewritten.map(Number)))
        chapter.prerequisites = rewritten.join(", ") || "none";
    }
    chapter.number = i + 1;
  }
  const slugs = chapters.map((c) => slugify(c.title, 40));
  if (slugs.some((slug) => !slug) || new Set(slugs).size !== slugs.length)
    throw new Error("Chapter titles must have distinct identities");
  validatePrerequisites(chapters);
  return chapters;
}

export function curriculumView(text: string): { raw: string; chapters: PlanProposalChapter[] } {
  return {
    raw: text,
    chapters: parseCurriculum(text).map((c, i) => ({
      number: c.number ?? i + 1,
      title: c.title,
      scope: c.scope,
      prerequisites: c.prerequisites,
      visuals: c.visuals,
      images: c.images ?? [],
      video: c.video,
      ticked: c.checked,
    })),
  };
}
