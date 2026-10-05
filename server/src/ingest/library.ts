import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { SourceSummary, SourceType, YoutubeTranscriptStatus } from "@studium/shared";
import { parseFrontmatter, SourceFrontmatter } from "@studium/shared";
import { stringify as stringifyYaml } from "yaml";
import { readText } from "../tree/edit.js";
import { commitPaths } from "../tree/git.js";
import { canonicalRel, resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";
import {
  type DedupeKey,
  dedupeKeyFromSource,
  dedupeKeyFromUrl,
  keysMatch,
  LIBRARY_DIR,
  sha256Hex,
  sourceIdBase,
  uniqueSourceId,
} from "./ids.js";
import { collectImages } from "./images.js";
import { scoreParseQuality } from "./quality.js";
import { sourceSections } from "./sections.js";
import { type ParsedPart, splitParsed } from "./split.js";
import type { Extracted } from "./types.js";

/** The original bytes an ingest is storing next to its parsed text. */
export interface WriteSourceOriginal {
  bytes: Uint8Array;
  /** Extension without the dot, e.g. `pdf`. */
  ext: string;
}

export interface WriteSourceResult {
  id: string;
  /** True when an identical source already existed and nothing was written. */
  deduped: boolean;
  /** SHA of the `librarian: ingest` commit; null when the source was already present. */
  commitSha: string | null;
}

export interface SourceView {
  source: SourceSummary;
  body: string;
  /** `parsed.md`, or the sorted `parsed/NN-slug.md` parts. */
  parsedFiles: string[];
}

/** Job input shared by `POST /api/library` and the `_inbox` watcher (T7 handler). */
export interface IngestJobInput {
  url?: string;
  filename?: string;
  mime?: string;
  bytes?: Uint8Array;
  set?: string | null;
  /** Root-relative path of the dropped file in library/_inbox/; the ingest job removes it on success. */
  inboxPath?: string;
  /**
   * Explicit retry target: re-run the transcript ladder for this existing
   * source in place, keeping its id and set links (never a new JobKind).
   */
  retrySourceId?: string;
}

/** Stored `source.md` marker while the librarian has not summarised the source yet. */
export const PENDING_CREDIBILITY = "pending";

function safeFrontmatter(text: string): Record<string, unknown> {
  try {
    return parseFrontmatter(text).frontmatter;
  } catch {
    return {};
  }
}

/** `library/<src-id>` directory names only (skips `_inbox`, `_jobs.md`, dotfiles). */
async function sourceIds(root: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(path.join(root, LIBRARY_DIR), { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_") && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
}

async function readFrontmatter(root: string, id: string): Promise<Record<string, unknown> | null> {
  let text: string;
  try {
    text = await fs.readFile(resolveInRoot(root, `${LIBRARY_DIR}/${id}/source.md`), "utf8");
  } catch {
    return null;
  }
  return safeFrontmatter(text);
}

/** Find an existing source with the same checksum, URL, arXiv id or DOI. */
export async function findDuplicate(root: string, key: DedupeKey): Promise<string | null> {
  for (const id of await sourceIds(root)) {
    const frontmatter = await readFrontmatter(root, id);
    if (frontmatter !== null && keysMatch(dedupeKeyFromSource(frontmatter), key)) return id;
  }
  return null;
}

/** True when a stored source still carries the pending-summary marker. */
export async function isSourcePending(root: string, id: string): Promise<boolean> {
  const frontmatter = await readFrontmatter(root, id);
  return frontmatter !== null && frontmatter.credibility === PENDING_CREDIBILITY;
}

/** Lock keys that identify a dedupe bucket (normalized URL / arXiv / DOI / sha256). */
export function dedupeLockKeys(key: DedupeKey): string[] {
  const keys: string[] = [];
  if (typeof key.sha256 === "string" && key.sha256 !== "") keys.push(`sha256:${key.sha256}`);
  if (typeof key.url === "string" && key.url !== "") keys.push(`url:${key.url}`);
  if (typeof key.arxivId === "string" && key.arxivId !== "") keys.push(`arxiv:${key.arxivId}`);
  if (typeof key.doi === "string" && key.doi !== "") keys.push(`doi:${key.doi}`);
  return keys;
}

// In-process async mutex per dedupe key. Jobs that could touch the same source
// take every key in sorted order so lookup → extract → write cannot race.
const dedupeLocks = new Map<string, Promise<void>>();

function acquireDedupeLock(key: string): Promise<() => void> {
  const previous = dedupeLocks.get(key) ?? Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const tail = previous.then(() => next);
  dedupeLocks.set(key, tail);
  void tail.then(() => {
    if (dedupeLocks.get(key) === tail) dedupeLocks.delete(key);
  });
  return previous.then(() => release);
}

/** Run `fn` while holding the in-process lock for every supplied dedupe key. */
export async function withDedupeLock<T>(keys: readonly string[], fn: () => Promise<T>): Promise<T> {
  const unique = [...new Set(keys)].sort();
  const releases: Array<() => void> = [];
  try {
    for (const key of unique) releases.push(await acquireDedupeLock(key));
    return await fn();
  } finally {
    for (const release of releases.reverse()) release();
  }
}

function dedupeKeyFor(extracted: Extracted, sha256: string | null): DedupeKey {
  const key = extracted.url === null ? {} : dedupeKeyFromUrl(extracted.url);
  return { ...key, sha256 };
}

/** Map an extractor result onto the STUDY_TREE `type` field. */
export function sourceTypeOf(extracted: Extracted): SourceType {
  if (extracted.parseTier === "transcript") return "video";
  // Embed-only YouTube sources keep an honest video type so the UI embeds them.
  if (extracted.unreadable === true && isYoutubeUrl(extracted.url)) return "video";
  switch ((extracted.originalExt ?? "").toLowerCase()) {
    case "epub":
      return "book";
    case "pdf":
      return "paper";
    case "md":
    case "markdown":
    case "txt":
    case "text":
      return "notes";
    default:
      return "article";
  }
}

function isYoutubeUrl(url: string | null): boolean {
  if (url === null) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com" ||
      host === "music.youtube.com" ||
      host === "youtube-nocookie.com" ||
      host === "www.youtube-nocookie.com" ||
      host === "youtu.be" ||
      host === "www.youtu.be"
    );
  } catch {
    return false;
  }
}

function frontmatterBlock(frontmatter: Record<string, unknown>): string {
  return `---\n${stringifyYaml(frontmatter, { lineWidth: 0 })}---`;
}

// T7 replaces this placeholder body with the librarian's summary + TOC + reason.
function renderBody(title: string, toc: string | null): string {
  const lines = [`# ${title} - summary`, "", "Summary pending.", ""];
  if (toc !== null) lines.push("## Contents", "", toc, "");
  return `${lines.join("\n").replace(/\n+$/, "")}\n`;
}

/**
 * Placeholder for an embed-only source with no readable text: the warning is
 * surfaced in frontmatter and here, and no parsed files are written, so agents
 * cannot cite invented prose.
 */
function renderUnreadableBody(title: string, warning: string | null): string {
  const note = warning ?? "No transcript is available for this video.";
  return `${[`# ${title}`, "", note, "", "This source is embedded for watching only."].join("\n")}\n`;
}

/**
 * Persist an extracted source under `library/<src-id>/` (decisions 8-9):
 * `source.md` frontmatter + pending summary, `parsed.md` or `parsed/NN-slug.md`,
 * and `original.<ext>` when the bytes are available. Commits the tracked paths
 * (the gitignored original is written but never committed).
 */
export async function writeSource(
  root: string,
  extracted: Extracted,
  original?: WriteSourceOriginal,
): Promise<WriteSourceResult> {
  const sha256 = original === undefined ? null : sha256Hex(original.bytes);
  const existing = await findDuplicate(root, dedupeKeyFor(extracted, sha256));
  if (existing !== null) return { id: existing, deduped: true, commitSha: null };

  const id = await uniqueSourceId(
    root,
    sourceIdBase({ authors: extracted.authors, title: extracted.title, url: extracted.url }),
  );
  const dir = `${LIBRARY_DIR}/${id}`;
  const title = extracted.title ?? "Untitled source";
  const split = splitParsed(extracted.markdown);
  const unreadable = extracted.unreadable === true;

  const frontmatter: Record<string, unknown> = {
    id,
    title,
    authors: extracted.authors,
    type: sourceTypeOf(extracted),
    ...(extracted.url === null ? {} : { url: extracted.url }),
    credibility: unreadable ? "unreadable" : PENDING_CREDIBILITY,
    parse_tier: extracted.parseTier,
    quality: scoreParseQuality(unreadable ? "" : extracted.markdown),
    ...(sha256 === null ? {} : { sha256 }),
    added: new Date().toISOString().slice(0, 10),
    ...(extracted.warning === null ? {} : { parse_warning: extracted.warning }),
    ...(extracted.transcriptStatus === null || extracted.transcriptStatus === undefined
      ? {}
      : { transcript_status: extracted.transcriptStatus }),
  };

  // Commit only the tracked paths: `original.<ext>` is intentionally gitignored
  // (`**/original.*`), and git refuses an explicit `add` of an ignored path.
  const tracked: string[] = [];
  await fs.mkdir(resolveInRoot(root, dir), { recursive: true });
  const sourceRel = `${dir}/source.md`;
  await fs.writeFile(
    resolveInRoot(root, sourceRel),
    `${frontmatterBlock(frontmatter)}\n\n${unreadable ? renderUnreadableBody(title, extracted.warning) : renderBody(title, split.toc)}`,
    "utf8",
  );
  tracked.push(sourceRel);
  if (extracted.thumb) {
    const thumbRel = `${dir}/thumb.jpg`;
    await fs.writeFile(resolveInRoot(root, thumbRel), extracted.thumb);
    tracked.push(thumbRel);
  }
  if (
    !unreadable &&
    (extracted.images !== undefined ||
      (extracted.url && extracted.originalExt === null && extracted.parseTier !== "transcript"))
  ) {
    const imagesRel = `${dir}/images.json`;
    await fs.writeFile(
      resolveInRoot(root, imagesRel),
      JSON.stringify(extracted.images ?? collectImages(extracted.markdown, extracted.url ?? ""), null, 2),
    );
    tracked.push(imagesRel);
  }

  if (!unreadable) {
    for (const part of split.parts) tracked.push(await writePart(root, dir, part));
    const sectionsRel = `${dir}/sections.json`;
    await fs.writeFile(
      resolveInRoot(root, sectionsRel),
      JSON.stringify(
        sourceSections(extracted.markdown).map(({ anchor, summary }) => ({ anchor, summary })),
        null,
        2,
      ),
    );
    tracked.push(sectionsRel);
  }

  if (original !== undefined) {
    await fs.writeFile(resolveInRoot(root, `${dir}/original.${original.ext}`), original.bytes);
  }

  const commitSha = await commitPaths(root, tracked, `librarian: ingest ${id}`, "librarian");
  return { id, deduped: false, commitSha };
}

async function writePart(root: string, dir: string, part: ParsedPart): Promise<string> {
  const rel = `${dir}/${part.path}`;
  const abs = resolveInRoot(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, part.content, "utf8");
  return rel;
}

async function parsedFiles(root: string, id: string): Promise<string[]> {
  const dir = resolveInRoot(root, `${LIBRARY_DIR}/${id}`);
  const files: string[] = [];
  try {
    const stats = await fs.stat(path.join(dir, "parsed.md"));
    if (stats.isFile()) files.push("parsed.md");
  } catch {
    // No single-file parse; check for split parts below.
  }
  try {
    const entries = await fs.readdir(path.join(dir, "parsed"), { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".md")) files.push(`parsed/${entry.name}`);
    }
  } catch {
    // No split directory.
  }
  return files.sort();
}

// Which sets list each source id in their `PLAN.md` frontmatter `sources`.
async function setsBySourceId(root: string): Promise<Map<string, string[]>> {
  const map = new Map<string, string[]>();
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return map;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSetSlug(entry.name)) continue;
    let text: string;
    try {
      text = await fs.readFile(path.join(root, entry.name, "PLAN.md"), "utf8");
    } catch {
      continue;
    }
    const sources = safeFrontmatter(text).sources;
    if (!Array.isArray(sources)) continue;
    for (const sourceId of sources) {
      if (typeof sourceId !== "string" || sourceId === "") continue;
      const list = map.get(sourceId);
      if (list === undefined) map.set(sourceId, [entry.name]);
      else list.push(entry.name);
    }
  }
  return map;
}

function refreshMetadata(value: unknown, id: string): import("@studium/shared").SourceRefreshResult | undefined {
  if (!value || typeof value !== "object") return undefined;
  const r = value as Record<string, unknown>;
  if (
    r.sourceId !== id ||
    !["refreshed", "unchanged", "skipped"].includes(String(r.status)) ||
    typeof r.before !== "number" ||
    !Number.isFinite(r.before) ||
    r.before < 0 ||
    r.before > 100 ||
    typeof r.after !== "number" ||
    !Number.isFinite(r.after) ||
    r.after < 0 ||
    r.after > 100 ||
    !Array.isArray(r.disappearedAnchors) ||
    !r.disappearedAnchors.every((a) => typeof a === "string")
  )
    return undefined;
  return {
    sourceId: id,
    before: r.before,
    after: r.after,
    status: r.status as import("@studium/shared").SourceRefreshResult["status"],
    disappearedAnchors: r.disappearedAnchors,
    ...(typeof r.reason === "string" ? { reason: r.reason } : {}),
  };
}

function summaryFrom(id: string, frontmatter: Record<string, unknown>, sets: string[]): SourceSummary {
  const parsed = SourceFrontmatter.safeParse(frontmatter);
  const data = parsed.success ? parsed.data : null;
  const warning = frontmatter.parse_warning;
  const transcriptStatus = frontmatter.transcript_status;
  return {
    ...(data?.quality ? { quality: data.quality.score } : {}),
    ...(typeof frontmatter.refreshed_at === "string" ? { refreshedAt: frontmatter.refreshed_at } : {}),
    ...(refreshMetadata(frontmatter.last_refresh, id)
      ? { lastRefresh: refreshMetadata(frontmatter.last_refresh, id) }
      : {}),
    id,
    title: data?.title ?? id,
    authors: data?.authors ?? [],
    type: data?.type ?? "other",
    url: typeof data?.url === "string" ? data.url : null,
    credibility: typeof data?.credibility === "string" ? data.credibility : null,
    parseTier: data?.parse_tier ?? "basic",
    addedAt: typeof data?.added === "string" ? data.added : "",
    sets: [...sets].sort(),
    warning: typeof warning === "string" && warning !== "" ? warning : null,
    transcriptStatus: isTranscriptStatus(transcriptStatus) ? transcriptStatus : null,
  };
}

const TRANSCRIPT_STATUSES = new Set<YoutubeTranscriptStatus>(["blocked", "no-captions", "disabled", "unavailable"]);

function isTranscriptStatus(value: unknown): value is YoutubeTranscriptStatus {
  return typeof value === "string" && TRANSCRIPT_STATUSES.has(value as YoutubeTranscriptStatus);
}

/** Summaries for every `library/<src-id>/source.md`, newest first. */
export async function listSources(root: string): Promise<SourceSummary[]> {
  const sets = await setsBySourceId(root);
  const summaries: SourceSummary[] = [];
  for (const id of await sourceIds(root)) {
    const frontmatter = await readFrontmatter(root, id);
    if (frontmatter === null) continue;
    summaries.push(summaryFrom(id, frontmatter, sets.get(id) ?? []));
  }
  summaries.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.id.localeCompare(b.id));
  return summaries;
}

/** Resolve only the sources explicitly linked in this set's PLAN.md. */
export async function listSetSources(root: string, set: string): Promise<SourceSummary[]> {
  const sources = safeFrontmatter(await readText(root, `${set}/PLAN.md`)).sources;
  if (!Array.isArray(sources)) return [];
  const linked = new Set(sources.filter((id): id is string => typeof id === "string"));
  const sets = await setsBySourceId(root);
  const summaries: SourceSummary[] = [];
  // Enumerated library ids exclude missing entries and user-edited path escapes.
  for (const id of await sourceIds(root)) {
    if (!linked.has(id)) continue;
    const frontmatter = await readFrontmatter(root, id);
    if (frontmatter !== null) summaries.push(summaryFrom(id, frontmatter, [...new Set(sets.get(id) ?? [])]));
  }
  return summaries.sort((a, b) => b.addedAt.localeCompare(a.addedAt) || a.id.localeCompare(b.id));
}

/** One source's summary, `source.md` body and parsed files; null when unknown. */
export async function readSource(root: string, id: string): Promise<SourceView | null> {
  let text: string;
  try {
    text = await fs.readFile(resolveInRoot(root, `${LIBRARY_DIR}/${id}/source.md`), "utf8");
  } catch {
    return null;
  }
  const frontmatter = safeFrontmatter(text);
  const sets = (await setsBySourceId(root)).get(id) ?? [];
  return {
    source: summaryFrom(id, frontmatter, sets),
    body: parseBody(text),
    parsedFiles: await parsedFiles(root, id),
  };
}

/**
 * Read one of a source's `parsedFiles` by its listed name (`parsed.md` or
 * `parsed/<name>.md`); null when the id or file is unknown or unreadable.
 */
export async function readParsedFile(root: string, id: string, file: string): Promise<string | null> {
  const view = await readSource(root, id);
  if (view === null || !view.parsedFiles.includes(file)) return null;
  try {
    const rel = `${LIBRARY_DIR}/${id}/${file}`;
    const parsed = `${LIBRARY_DIR}/${id}/parsed`;
    const isParsedPath = (candidate: string) => candidate === `${parsed}.md` || candidate.startsWith(`${parsed}/`);
    if (!isParsedPath(rel) || !isParsedPath(canonicalRel(root, rel))) return null;
    return await fs.readFile(resolveInRoot(root, rel), "utf8");
  } catch {
    return null;
  }
}

function parseBody(text: string): string {
  try {
    return parseFrontmatter(text).body;
  } catch {
    return text;
  }
}
