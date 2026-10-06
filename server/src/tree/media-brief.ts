import { promises as fs } from "node:fs";
import path from "node:path";
import type { ChapterMedia } from "@studium/shared";
import { parseFrontmatter } from "@studium/shared";
import { chapterVisuals, mediaAttributes, resolveNoteMedia } from "@studium/shared/media";
import { parseWidget } from "@studium/shared/visuals";
import { parseSketchHeader } from "@studium/shared/visuals/sketch";
import { stringify } from "yaml";
import { z } from "zod";
import { slugify } from "../ingest/ids.js";
import {
  type CurriculumChapter,
  chapterExists,
  interactiveIntent,
  interactivePlanIssues,
  noInteractiveReason,
  parseCurriculum,
} from "./curriculum.js";
import { readText, writeTextLocked } from "./edit.js";
import { commitPaths } from "./git.js";
import type { FileLocks } from "./lock.js";
import { canonicalRel, resolveInRoot } from "./paths.js";
import { readSetFile } from "./read.js";
import { lintVisualHtml } from "./visual-lint.js";

const Figure = z.object({
  sourceId: z.string(),
  path: z.string().optional(),
  url: z.string(),
  alt: z.string(),
  caption: z.string(),
  section: z.string(),
  license: z.string().optional(),
  credit: z.string(),
  creator: z.string().optional(),
  sourcePage: z.string().optional(),
  licenseUrl: z.string().optional(),
  width: z.number().optional(),
  height: z.number().optional(),
});
const Table = z.object({ sourceId: z.string(), file: z.string(), anchor: z.string(), text: z.string() });
export const MediaBriefSchema = z.object({
  chapter: z.string(),
  scope: z.string(),
  refinedAt: z.string(),
  noInteractiveReason: z.string().optional(),
  visuals: z
    .array(
      z.object({
        id: z.string().regex(/^visual-\d+$/),
        intent: z.string(),
        form: z.string().optional(),
        concept: z.string().optional(),
        evidence: z
          .array(
            z.object({ sourceId: z.string(), file: z.string(), anchor: z.string(), figure: z.string().optional() }),
          )
          .max(2)
          .optional(),
      }),
    )
    .max(20),
  images: z
    .array(
      z.object({
        id: z.string().regex(/^image-\d+$/),
        intent: z.string(),
        reason: z.string().optional(),
        choice: z
          .object({
            url: z.string(),
            thumbnail: z.string().optional(),
            title: z.string(),
            creator: z.string(),
            // D38: a chosen image may have no stated licence; save_asset labels it "Licence unknown".
            license: z.string().optional(),
            licenseUrl: z.string().optional(),
            sourcePage: z.string().optional(),
            width: z.number().optional(),
            height: z.number().optional(),
            sourceId: z.string().optional(),
            path: z.string().optional(),
          })
          .optional(),
      }),
    )
    .max(3)
    .optional(),
  // Owner decision M16: capture every useful content figure; the 5 KB prompt budget, not a
  // fixed count, decides how many reach an agent prompt.
  figures: z.array(Figure).max(400),
  tables: z.array(Table).max(50),
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
    return parsed.success && parsed.data.chapter === chapter.title ? leanMediaBrief(parsed.data) : null;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "not_found") return null;
    throw error;
  }
}
export const MAX_MEDIA_BRIEF_BYTES = 5120;
function renderBrief(brief: MediaBrief): string {
  return `---\n${stringify(brief, { lineWidth: 0 })}---\n\n# Chapter media\n`;
}

// Common words carry no concept signal; keeping them would rank every figure near-equal.
const RELEVANCE_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "with",
  "that",
  "this",
  "from",
  "into",
  "your",
  "their",
  "them",
  "they",
  "these",
  "those",
  "same",
  "when",
  "where",
  "which",
  "while",
  "will",
  "would",
  "should",
  "could",
  "have",
  "has",
  "had",
  "are",
  "was",
  "were",
  "been",
  "not",
  "but",
  "its",
  "you",
  "can",
  "use",
  "used",
  "using",
  "one",
  "two",
  "three",
  "more",
  "than",
  "then",
  "only",
  "also",
  "about",
  "over",
  "under",
  "between",
  "across",
  "each",
  "other",
  "some",
  "any",
  "our",
  "out",
  "how",
  "why",
  "what",
  "who",
  "write",
  "read",
  "draw",
  "drawing",
  "simple",
  "make",
  "made",
  "show",
  "shows",
  "shown",
  "need",
  "needs",
  "like",
  "such",
  "part",
  "parts",
  "type",
  "types",
]);

function relevanceTerms(text: string | undefined): string[] {
  const words = (text ?? "").toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  return [...new Set(words.filter((term) => !RELEVANCE_STOPWORDS.has(term)))];
}

interface RelevanceChapter {
  title?: string;
  scope?: string;
  visuals?: readonly (string | { intent?: string })[];
  video?: string | { intent?: string };
}

/** Term weights for a chapter: scope and visual intents outrank the title and video need. */
export function figureRelevanceWeights(chapter: RelevanceChapter): Map<string, number> {
  const weights = new Map<string, number>();
  const add = (text: string | undefined, weight: number) => {
    for (const term of relevanceTerms(text)) weights.set(term, Math.max(weights.get(term) ?? 0, weight));
  };
  add(chapter.title, 2);
  add(chapter.scope, 3);
  for (const visual of chapter.visuals ?? [])
    add((typeof visual === "string" ? visual : visual.intent)?.replace(/^[a-z-]+\s*[—–-]\s*/i, ""), 3);
  add(typeof chapter.video === "string" ? chapter.video : chapter.video?.intent, 1);
  return weights;
}

export function figureRelevance(
  figure: { caption?: string; alt?: string; section?: string },
  weights: ReadonlyMap<string, number>,
): number {
  const text = `${figure.caption ?? ""} ${figure.alt ?? ""} ${figure.section ?? ""}`.toLowerCase();
  let score = 0;
  for (const [term, weight] of weights) if (text.includes(term)) score += weight;
  return score;
}

/** Most relevant figures first; downloaded candidates break ties, then original order. */
export function rankFiguresForBrief<T extends { caption: string; alt: string; section: string; path?: string }>(
  figures: readonly T[],
  chapter: RelevanceChapter,
): T[] {
  const weights = figureRelevanceWeights(chapter);
  return figures
    .map((figure, index) => ({ figure, index, score: figureRelevance(figure, weights) }))
    .sort((a, b) => b.score - a.score || Number(!!b.figure.path) - Number(!!a.figure.path) || a.index - b.index)
    .map((entry) => entry.figure);
}

export function rankTablesForBrief<T extends { text: string }>(tables: readonly T[], chapter: RelevanceChapter): T[] {
  const weights = figureRelevanceWeights(chapter);
  return tables
    .map((table, index) => ({ table, index, score: figureRelevance({ caption: table.text }, weights) }))
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.table);
}

/** Old briefs remain readable; only the bounded selection enters agent prompts. */
export function leanMediaBrief(brief: MediaBrief): MediaBrief {
  const lean = MediaBriefSchema.parse(brief);
  // Rank by chapter scope/intents before the byte budget trims, so the most relevant figures
  // survive the prompt compaction instead of the first N in capture order.
  lean.figures = rankFiguresForBrief(lean.figures, lean).map((f) => ({
    ...f,
    alt: f.alt.slice(0, 160),
    caption: f.caption.slice(0, 300),
    section: f.section.slice(0, 120),
    credit: f.credit.slice(0, 300),
  }));
  lean.tables = rankTablesForBrief(lean.tables, lean).map((t) => ({ ...t, text: t.text.slice(0, 400) }));
  if (lean.video.reason) lean.video.reason = lean.video.reason.slice(0, 300);
  const fits = () =>
    Math.max(Buffer.byteLength(renderBrief(lean)), Buffer.byteLength(JSON.stringify(lean))) <= MAX_MEDIA_BRIEF_BYTES;
  if (!fits())
    for (const image of lean.images ?? []) {
      if (image.reason) image.reason = image.reason.slice(0, 180);
      if (image.choice) {
        image.choice.title = image.choice.title.slice(0, 120);
        image.choice.creator = image.choice.creator.slice(0, 180);
        // Prompt hints only: save_asset resolves complete attribution from the evidence sidecar.
        delete image.choice.thumbnail;
        delete image.choice.licenseUrl;
        delete image.choice.sourcePage;
        delete image.choice.path;
      }
    }
  // Select evidence that adds chapter concepts before repeating concepts already represented.
  // Figures and tables compete together, and an oversized candidate cannot crowd out a smaller one.
  const weights = figureRelevanceWeights(lean);
  const remaining = new Map(weights);
  const candidates = [
    ...lean.figures.map((item) => ({
      kind: "figure" as const,
      item,
      text: `${item.caption} ${item.alt} ${item.section}`.toLowerCase(),
      relevance: figureRelevance(item, weights),
    })),
    ...lean.tables.map((item) => ({
      kind: "table" as const,
      item,
      text: item.text.toLowerCase(),
      relevance: figureRelevance({ caption: item.text }, weights),
    })),
  ].filter((candidate) => candidate.relevance > 0);
  lean.figures = [];
  lean.tables = [];
  const score = (candidate: (typeof candidates)[number]) =>
    figureRelevance({ caption: candidate.text }, remaining) + candidate.relevance / 4;
  while (candidates.length) {
    candidates.sort((a, b) => score(b) - score(a));
    const candidate = candidates.shift();
    if (!candidate) break;
    if (candidate.kind === "figure") lean.figures.push(candidate.item);
    else lean.tables.push(candidate.item);
    if (!fits()) {
      if (candidate.kind === "figure") lean.figures.pop();
      else lean.tables.pop();
      continue;
    }
    for (const term of remaining.keys()) if (candidate.text.includes(term)) remaining.delete(term);
  }
  if (!fits()) throw new Error("Visual specifications exceed the 5 KB media brief budget; shorten the plan intents");
  return lean;
}

export async function saveMediaBrief(
  root: string,
  locks: FileLocks,
  set: string,
  chapter: CurriculumChapter,
  brief: MediaBrief,
  candidates?: unknown,
): Promise<MediaBrief> {
  const rel = mediaBriefPath(set, chapter);
  const evidenceRel = rel.replace(/\.md$/, ".evidence.json");
  const holder = `outliner:media:${crypto.randomUUID()}`;
  const issues = interactivePlanIssues([
    ...brief.visuals.map((v) => v.intent),
    ...(brief.noInteractiveReason ? [`no interactive visual: ${brief.noInteractiveReason}`] : []),
  ]);
  if (issues.length) throw new Error(issues.join("; "));
  const valid = leanMediaBrief(brief);
  await locks.withLock(rel, holder, async () => {
    for (const p of [rel, evidenceRel])
      if (canonicalRel(root, p) !== p) throw new Error("Media brief paths may not be symlink aliases");
    await fs.mkdir(path.dirname(resolveInRoot(root, rel)), { recursive: true });
    await locks.withLock(evidenceRel, holder, async () => {
      await writeTextLocked(
        root,
        locks,
        holder,
        evidenceRel,
        `${JSON.stringify({ ...MediaBriefSchema.parse(brief), ...(candidates ? { candidates } : {}) }, null, 2)}\n`,
        (p) => p === evidenceRel,
      );
    });
    await writeTextLocked(root, locks, holder, rel, renderBrief(valid), (p) => p === rel);
    await commitPaths(root, [rel, evidenceRel], `outliner: media for ${chapter.title}`, "outliner");
  });
  return valid;
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
  const attachments = new Set(chapterVisuals(parseFrontmatter(text).body, notePath).visuals.map((v) => v.src));
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
      if (
        (visual.form && interactiveIntent(`${visual.form} — ${visual.concept || visual.intent}`)) ||
        interactiveIntent(visual.intent)
      ) {
        const media = src ? resolveNoteMedia(notePath, src, "visual") : null;
        made = made && following.startsWith("::visual{") && !!media && attachments.has(`${media.set}/${media.path}`);
        if (made && media) {
          try {
            const content = await readText(root, `${media.set}/${media.path}`);
            if (media.path.endsWith(".json")) {
              const widget = parseWidget(content);
              if (widget.type === "step-through" && widget.steps.length < 2) made = false;
              if (widget.type === "function-plot" && !widget.params.length && (widget.story?.scenes.length ?? 0) < 2)
                made = false;
            } else {
              parseSketchHeader(content);
              if (lintVisualHtml(content).errors.length) made = false;
            }
          } catch {
            made = false;
          }
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
        ...(reason && reason.length >= 12 && /^\*[^*]+\*|^_[^_]+_/.test(explanation)
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
  const issues = interactivePlanIssues([
    ...brief.visuals.map((v) => v.intent),
    ...(brief.noInteractiveReason ? [`no interactive visual: ${brief.noInteractiveReason}`] : []),
  ]);
  const interactivePaths = visuals
    .filter((v, i) => v.made && interactiveIntent(brief.visuals[i]?.intent ?? ""))
    .map((v) => v.path);
  if (new Set(interactivePaths).size !== interactivePaths.length)
    issues.push("Each planned interactive concept needs a distinct Visuals-tab attachment");
  return [
    ...issues,
    ...(await plannedImageBlockers(root, notePath, text, brief)),
    ...visuals
      .filter((v) => !v.made && !v.reason)
      .map((v) => `Planned visual is missing without an explanation: ${v.intent}`),
  ];
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
    JSON.stringify(saved.visuals.map((v) => v.intent)) ===
      JSON.stringify(chapter.visuals.filter((v) => !/^no interactive visual:/i.test(v))) &&
    JSON.stringify(saved.images?.map((i) => i.intent) ?? []) === JSON.stringify(chapter.images ?? []) &&
    saved.noInteractiveReason === noInteractiveReason(chapter.visuals)
  )
    return saved;
  if (!chapter.visuals.length && !chapter.images?.length) return null;
  // Missing/stale refinement must not bypass the curriculum's visual requirements.
  return {
    chapter: chapter.title,
    scope: chapter.scope,
    refinedAt: "",
    ...(noInteractiveReason(chapter.visuals) ? { noInteractiveReason: noInteractiveReason(chapter.visuals) } : {}),
    visuals: chapter.visuals
      .filter((v) => !/^no interactive visual:/i.test(v))
      .map((intent, i) => ({ id: `visual-${i + 1}`, intent, ...(interactiveIntent(intent) ?? {}) })),
    images: (chapter.images ?? []).slice(0, 3).map((intent, i) => ({ id: `image-${i + 1}`, intent })),
    figures: [],
    tables: [],
    video: { intent: chapter.video, status: "none", reason: "Media sources have not been refined yet." },
  };
}

/** Image markers share the omission contract, but only a local raster fulfils an image slot. */
export async function plannedImageBlockers(
  root: string,
  notePath: string,
  text: string,
  brief: MediaBrief,
): Promise<string[]> {
  const body = parseFrontmatter(text).body.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^\1\s*$/gm, "");
  const issues: string[] = [];
  for (const image of brief.images ?? []) {
    const escaped = image.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const src = new RegExp(`<!-- media:${escaped} -->\\s*\\n\\s*!\\[[^\\]]*\\]\\(<?([^\\s)>]+)>?`).exec(body)?.[1];
    const media = src ? resolveNoteMedia(notePath, src) : null;
    const rel = media ? `${media.set}/${media.path}` : "";
    const made =
      !!rel &&
      /\.(png|jpe?g|gif|webp)$/i.test(rel) &&
      canonicalRel(root, rel) === rel &&
      (await fs.stat(resolveInRoot(root, rel)).catch(() => null))?.isFile();
    const omitted = new RegExp(
      `<!-- media:${escaped} unavailable: ([^\\n]{12,}) -->\\s*\\n\\s*([*_])[^*_\\n]+\\2`,
    ).test(body);
    if (!made && !omitted) issues.push(`Planned image is missing without an explanation: ${image.intent}`);
  }
  return issues;
}
/** save_asset accepts search metadata only from persisted, server-selected briefs. */
export async function chosenBriefImage(
  root: string,
  set: string,
  url: string,
): Promise<NonNullable<NonNullable<MediaBrief["images"]>[number]["choice"]> | undefined> {
  const dir = `${set}/media`;
  if (canonicalRel(root, dir) !== dir) throw new Error("Media directory may not be an alias");
  const files = await fs.readdir(resolveInRoot(root, dir)).catch((error: NodeJS.ErrnoException) => {
    if (error.code === "ENOENT") return [];
    throw error;
  });
  for (const file of files.filter((f) => f.endsWith(".md")).slice(0, 200)) {
    const rel = `${dir}/${file}`;
    if (canonicalRel(root, rel) !== rel) continue;
    for (const candidate of [rel.replace(/\.md$/, ".evidence.json"), rel]) {
      if (canonicalRel(root, candidate) !== candidate) throw new Error("Image evidence may not be an alias");
      const abs = resolveInRoot(root, candidate);
      const stat = await fs.stat(abs).catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return null;
        throw error;
      });
      if (!stat?.isFile() || stat.size > 2 * 1024 * 1024) continue;
      const bytes = await fs.readFile(abs, "utf8");
      let value: unknown;
      try {
        value = candidate.endsWith(".json") ? JSON.parse(bytes) : parseFrontmatter(bytes).frontmatter;
      } catch {
        continue;
      }
      const brief = MediaBriefSchema.safeParse(value);
      const choice = brief.success ? brief.data.images?.find((i) => i.choice?.url === url)?.choice : undefined;
      if (choice) return choice;
    }
  }
  return undefined;
}
