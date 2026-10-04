import { slugify } from "./ids.js";

/** Parsed text under this size stays in a single `parsed.md` (decision 9). */
export const PARSED_MAX_BYTES = 50 * 1024;
/** Large section/files are chunked at paragraph boundaries to at most this size. */
export const PART_TARGET_BYTES = 40 * 1024;
const MAX_PART_SLUG = 40;

export interface ParsedPart {
  /** Study-root relative from the source dir: `parsed.md` or `parsed/NN-slug.md`. */
  path: string;
  content: string;
}

export interface SplitResult {
  parts: ParsedPart[];
  /** Markdown TOC table (`| Section | Location |`) when split; null for a single file. */
  toc: string | null;
}

interface Section {
  title: string | null;
  content: string;
}

/**
 * Split extracted markdown into `parsed.md` files. Under {@link PARSED_MAX_BYTES}
 * the whole text is one file; above it, sections follow top-level headings, with
 * a paragraph-boundary fallback for headingless text or oversized sections.
 */
export function splitParsed(markdown: string, maxBytes = PARSED_MAX_BYTES): SplitResult {
  const content = markdown.endsWith("\n") ? markdown : `${markdown}\n`;
  if (byteLength(content) <= maxBytes) {
    return { parts: [{ path: "parsed.md", content }], toc: null };
  }

  const sections = sectionize(content);
  const useHeadings = sections.length >= 2 && sections.every((section) => byteLength(section.content) <= maxBytes);

  const parts: ParsedPart[] = [];
  for (const section of useHeadings ? sections : chunked(content)) {
    const index = parts.length + 1;
    parts.push({ path: partPath(index, section.title), content: ensureNewline(section.content) });
  }
  return { parts, toc: renderToc(parts, useHeadings ? sections : null) };
}

// Split on top-level (`#`) headings; anything before the first heading is its own section.
function sectionize(content: string): Section[] {
  const sections: Section[] = [];
  let title: string | null = null;
  let fence: string | undefined;
  let buffer: string[] = [];

  const flush = (): void => {
    const text = buffer.join("\n").trim();
    if (text !== "" || title !== null) sections.push({ title, content: text });
    buffer = [];
  };

  for (const line of content.split("\n")) {
    const marker = /^\s{0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (!fence) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
    }
    const heading = !fence ? /^#{1,2}\s+(.+?)\s*#*\s*$/.exec(line) : null;
    if (heading !== null) {
      flush();
      title = heading[1] ?? null;
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

function chunked(content: string): Section[] {
  const chunks: Section[] = [];
  let current = "";
  for (const paragraph of content.split(/\n{2,}/)) {
    const candidate = current === "" ? paragraph : `${current}\n\n${paragraph}`;
    if (current !== "" && byteLength(candidate) > PART_TARGET_BYTES) {
      chunks.push({ title: null, content: current });
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  if (current.trim() !== "") chunks.push({ title: null, content: current });
  return chunks.length > 0 ? chunks : [{ title: null, content }];
}

function partPath(index: number, title: string | null): string {
  const slug = title === null ? "" : slugify(title, MAX_PART_SLUG);
  const prefix = String(index).padStart(2, "0");
  return `parsed/${prefix}-${slug === "" ? "part" : slug}.md`;
}

function renderToc(parts: ParsedPart[], sections: Section[] | null): string {
  const rows = parts.map((part, index) => {
    const title = sections?.[index]?.title ?? `Part ${index + 1}`;
    return `| ${index + 1}. ${escapeCell(title)} | ${part.path} |`;
  });
  return ["| Section | Location |", "| --- | --- |", ...rows].join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").trim();
}

function ensureNewline(text: string): string {
  return text.endsWith("\n") ? text : `${text}\n`;
}

function byteLength(text: string): number {
  return Buffer.byteLength(text, "utf8");
}
