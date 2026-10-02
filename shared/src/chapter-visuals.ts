import { mediaAttributes, resolveNoteMedia } from "./media-paths.js";

export interface ChapterVisual {
  title: string;
  /** Root-relative, already confined to this chapter's set; absent for invalid declarations. */
  src?: string;
  poster?: string;
  kind?: "widget" | "sketch";
}

/** Callout containers (`:::example` … `:::`) hold prose; a declaration inside them is not an attachment. */
const CONTAINER_OPEN = /^ {0,3}:::+(?!artifact\b|visual\b)[A-Za-z][\w-]*(?:\{.*\})?\s*$/;
const CONTAINER_CLOSE = /^ {0,3}:::+\s*$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const DECLARATION = /^ {0,3}::(artifact|visual)\{(.*)\}\s*$/;

function fenceCloses(line: string, fence: string, fenceLength: number): boolean {
  const marker = FENCE.exec(line);
  return marker?.[1]?.[0] === fence && marker[1].length >= fenceLength && !marker[2]?.trim();
}

/** Standalone leaf declarations are chapter attachments, not prose. Code examples stay code. */
export function chapterVisuals(body: string, notePath: string): { body: string; visuals: ChapterVisual[] } {
  const visuals: ChapterVisual[] = [];
  const seen = new Set<string>();
  let fence = "";
  let fenceLength = 0;
  let containerDepth = 0;
  const lines = body.split("\n").map((line) => {
    const marker = FENCE.exec(line);
    if (fence) {
      if (fenceCloses(line, fence, fenceLength)) fence = "";
      return line;
    }
    if (marker?.[1]) {
      fence = marker[1][0] ?? "";
      fenceLength = marker[1].length;
      return line;
    }
    if (CONTAINER_CLOSE.test(line)) {
      if (containerDepth > 0) containerDepth--;
      return line;
    }
    if (CONTAINER_OPEN.test(line)) {
      containerDepth++;
      return line;
    }
    const declaration = DECLARATION.exec(line);
    if (!declaration || containerDepth > 0) return line;
    const attrs = mediaAttributes(declaration[2] ?? "");
    const media = attrs?.src
      ? resolveNoteMedia(notePath, attrs.src, declaration[1] === "visual" ? "visual" : "html")
      : null;
    const poster = attrs?.poster ? resolveNoteMedia(notePath, attrs.poster, "poster") : null;
    const src = media && (!attrs?.poster || poster) ? `${media.set}/${media.path}` : undefined;
    if (!src || !seen.has(src)) {
      visuals.push({
        title: attrs?.title?.trim().slice(0, 200) || "Interactive figure",
        ...(src ? { src } : {}),
        ...(declaration[1] === "visual"
          ? { kind: src?.endsWith(".json") ? ("widget" as const) : ("sketch" as const) }
          : {}),
        ...(src && poster ? { poster: `${poster.set}/${poster.path}` } : {}),
      });
      if (src) seen.add(src);
    }
    return "";
  });
  return { body: lines.join("\n"), visuals };
}

/**
 * Declaration lines `chapterVisuals` will not collect: quoted, list items, deeply indented,
 * inside a callout container, or written with three or more colons. A collected declaration is
 * an attachment; an uncollected one vanishes from both the reading view and the Visuals tab, so
 * writers use this to reject agent note writes and the reader shows a visible marker instead.
 */
export function misplacedVisualDeclarations(body: string): string[] {
  const misplaced: string[] = [];
  let fence = "";
  let fenceLength = 0;
  let containerDepth = 0;
  for (const line of body.split("\n")) {
    const marker = FENCE.exec(line);
    if (fence) {
      if (fenceCloses(line, fence, fenceLength)) fence = "";
      continue;
    }
    if (marker?.[1]) {
      fence = marker[1][0] ?? "";
      fenceLength = marker[1].length;
      continue;
    }
    if (CONTAINER_CLOSE.test(line)) {
      if (containerDepth > 0) containerDepth--;
      continue;
    }
    if (CONTAINER_OPEN.test(line)) {
      containerDepth++;
      continue;
    }
    if (
      /^ {0,3}:::+(artifact|visual)\{/.test(line) ||
      /^\s*>.*::(artifact|visual)\{/.test(line) ||
      /^\s*(?:[-*+]|\d+\.[.)]?)\s+::(artifact|visual)\{/.test(line) ||
      /^ {4,}::(artifact|visual)\{/.test(line) ||
      (containerDepth > 0 && DECLARATION.test(line))
    )
      misplaced.push(line.trim());
  }
  return misplaced;
}
