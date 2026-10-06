/**
 * M16 deterministic media-brief selection trial.
 *
 * Calls the *production* deterministic helper `collectChapterMediaCandidates`
 * (subject + interactive fallback, source-figure/table collection, relevance
 * ranking, per-visual evidence) and the production `leanMediaBrief` compaction,
 * reusing the chapter's existing video/image choices from its saved brief. No
 * model calls, no network, no writes to the tree.
 *
 * Usage: node --import tsx scripts/m16-figure-selection.ts <temp-tree> [set] [chapter-title]
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { parseFrontmatter } from "@studium/shared";
import { collectChapterMediaCandidates } from "../src/jobs/media-plan.js";
import { parseCurriculum } from "../src/tree/curriculum.js";
import { readText } from "../src/tree/edit.js";
import {
  figureRelevance,
  figureRelevanceWeights,
  leanMediaBrief,
  type MediaBrief,
  MediaBriefSchema,
  mediaBriefPath,
  rankFiguresForBrief,
  readMediaBrief,
} from "../src/tree/media-brief.js";

const root = process.argv[2];
if (!root || !/^\/tmp\/studium-m16-/.test(root)) throw new Error("Pass an M16 temporary tree");
const set = process.argv[3] ?? "polymers";
const wanted = process.argv[4] ?? "Carbon structures and reactive groups";

const plan = await readText(root, `${set}/PLAN.md`);
const sourceIds = parseFrontmatter(plan).frontmatter.sources;
const sources = Array.isArray(sourceIds) ? sourceIds.filter((id): id is string => typeof id === "string") : [];
const subject = String(parseFrontmatter(plan).frontmatter.subject ?? "general");
const curriculum = await readText(root, `${set}/curriculum.md`);
const chapterInput = parseCurriculum(curriculum).find((candidate) => candidate.title === wanted);
if (!chapterInput) throw new Error(`Chapter not found: ${wanted}`);

const prior = await readMediaBrief(root, set, chapterInput);
const candidates = await collectChapterMediaCandidates(root, chapterInput, sources, subject);
const chapter = candidates.chapter;
const brief: MediaBrief = {
  chapter: chapter.title,
  scope: chapter.scope,
  refinedAt: new Date().toISOString(),
  visuals: candidates.visuals,
  figures: candidates.figures,
  tables: candidates.tables,
  // Existing refinements are reused so the 5 KB compaction matches the real brief.
  images: prior?.images ?? candidates.images,
  video: prior?.video ?? { intent: chapter.video, status: "none", reason: "Selection trial only." },
};
const lean = leanMediaBrief(MediaBriefSchema.parse(brief));

// What the pre-M16 prompt would have shown: the stored brief's first six figures / two tables.
const stored = MediaBriefSchema.safeParse(
  parseFrontmatter(await readText(root, mediaBriefPath(set, chapter))).frontmatter,
);
const weights = {
  title: chapter.title,
  scope: chapter.scope,
  visuals: chapter.visuals,
  video: chapter.video,
};
const weightMap = figureRelevanceWeights(weights);
const ranked = rankFiguresForBrief(candidates.figures, weights);
const describe = (figure: MediaBrief["figures"][number]) => ({
  sourceId: figure.sourceId,
  caption: figure.caption.slice(0, 120),
  section: figure.section,
  score: figureRelevance(figure, weightMap),
  path: figure.path,
});
const report = {
  set,
  chapter: chapter.title,
  subject,
  fallbackVisuals: chapter.visuals,
  sources,
  collectedCount: candidates.figures.length,
  oldFirstSixFigures: stored.success ? stored.data.figures.slice(0, 6).map(describe) : [],
  oldFirstTwoTables: stored.success ? stored.data.tables.slice(0, 2).map((t) => t.text.slice(0, 160)) : [],
  rankedTopFigures: ranked.slice(0, 12).map(describe),
  candidateTableCount: candidates.tables.length,
  candidateTables: candidates.tables.map((t) => ({
    sourceId: t.sourceId,
    anchor: t.anchor,
    text: t.text.slice(0, 160),
  })),
  briefFigureCount: lean.figures.length,
  briefFigures: lean.figures.map(describe),
  briefTableCount: lean.tables.length,
  briefTables: lean.tables.map((t) => ({ sourceId: t.sourceId, anchor: t.anchor, text: t.text.slice(0, 160) })),
  briefVisuals: lean.visuals.map((v) => ({ intent: v.intent, evidence: v.evidence?.length ?? 0 })),
  briefImageSlots: lean.images?.map((i) => i.id) ?? [],
  briefBytes: Buffer.byteLength(JSON.stringify(lean)),
};
const out = path.join(path.dirname(root), "m16-figure-selection.json");
await fs.writeFile(out, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ out, ...report }, null, 2));
