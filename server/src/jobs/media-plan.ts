import { parseFrontmatter } from "@studium/shared";
import { Type } from "typebox";
import { scoutSourcesTool } from "../agent/builtins/scout-sources.js";
import { workspaceClassifier } from "../agent/classifier-workspace.js";
import { selectedPassage } from "../agent/passage.js";
import { defineTool, rethrowRoleModelError, runRole } from "../agent/run-role.js";
import { readSourceFigures } from "../ingest/figures.js";
import { readSource } from "../ingest/library.js";
import { configuredSearch, isWatchVideo } from "../search/backends.js";
import { rankPassages, sourcePassages } from "../search/passages.js";
import {
  type CurriculumChapter,
  interactiveIntent,
  interactivePlanIssues,
  noInteractiveReason,
  parseCurriculum,
  withInteractiveFallback,
} from "../tree/curriculum.js";
import { readText } from "../tree/edit.js";
import {
  figureRelevance,
  figureRelevanceWeights,
  type MediaBrief,
  rankFiguresForBrief,
  readMediaBrief,
  saveMediaBrief,
} from "../tree/media-brief.js";
import type { DraftJobDeps } from "./draft-job.js";
import { refineChapterImages } from "./image-plan.js";
import { createIngestJob } from "./ingest-job.js";
import { type JobContext, usageFromPiMessages } from "./runner.js";

export interface ChapterMediaCandidates {
  /** Chapter with the draft-time interactive fallback already applied. */
  chapter: CurriculumChapter;
  subject: string;
  figures: MediaBrief["figures"];
  tables: MediaBrief["tables"];
  visuals: MediaBrief["visuals"];
  images: NonNullable<MediaBrief["images"]>;
}

/**
 * The deterministic half of media refinement: subject/interactive fallback, candidate
 * collection, relevance ranking and per-visual evidence. Both production refinement and
 * the M16 selection trial call this exact helper so their 5 KB briefs agree.
 */
export async function collectChapterMediaCandidates(
  root: string,
  chapterInput: CurriculumChapter,
  sources: readonly string[],
  subject: string,
): Promise<ChapterMediaCandidates> {
  const chapter = withInteractiveFallback(chapterInput, subject);
  const passages = await sourcePassages(root, sources);
  const query = `${chapter.title} ${chapter.scope} ${chapter.visuals.join(" ")}`;
  const collected: MediaBrief["figures"] = [];
  for (const sourceId of sources) {
    for (const figure of await readSourceFigures(root, sourceId)) {
      // Every source figure competes; relevance only orders the ranked list.
      collected.push({ ...figure, sourceId, ...(figure.path ? { path: `library/${sourceId}/${figure.path}` } : {}) });
    }
  }
  // Scope and visual intents outrank capture order; downloaded candidates break ties.
  const figures = rankFiguresForBrief(collected, {
    title: chapter.title,
    scope: chapter.scope,
    visuals: chapter.visuals,
    video: chapter.video,
  });
  const figureScore = (figure: MediaBrief["figures"][number], intent: string) =>
    figureRelevance(figure, figureRelevanceWeights({ title: intent }));
  const tables = rankPassages(
    passages.filter((p) => /^\s*\|.*\|\s*$/m.test(p.text)),
    query,
  )
    .filter((p) => p.score > 0)
    .map((p) => ({ sourceId: p.source, file: p.file, anchor: p.anchor, text: p.text.slice(0, 6000) }));
  const visuals = chapter.visuals
    .filter((v) => !/^no interactive visual:/i.test(v))
    .slice(0, 20)
    .map((intent, i) => ({
      id: `visual-${i + 1}`,
      intent,
      ...(interactiveIntent(intent) ?? {}),
      evidence: rankPassages(passages, `${chapter.title} ${intent}`)
        .filter((p) => p.score > 0)
        .slice(0, 2)
        .map((p) => {
          const figure = figures
            .filter((f) => f.sourceId === p.source && f.path && figureScore(f, intent) > 0)
            .sort((a, b) => figureScore(b, intent) - figureScore(a, intent))[0];
          return {
            sourceId: p.source,
            file: p.file,
            anchor: p.anchor,
            ...(figure?.path ? { figure: figure.path } : {}),
          };
        }),
    }));
  return {
    chapter,
    subject,
    figures,
    tables,
    visuals,
    images: (chapter.images ?? []).slice(0, 3).map((intent, i) => ({ id: `image-${i + 1}`, intent })),
  };
}

/** Relevance here selects candidates; the independent checker verifies actual teaching use. */
export async function refineMediaBrief(
  deps: DraftJobDeps,
  set: string,
  chapterInput: CurriculumChapter,
  sources: string[],
  ctx: JobContext,
): Promise<MediaBrief> {
  const plan = await readText(deps.root, `${set}/PLAN.md`);
  const subject = String(parseFrontmatter(plan).frontmatter.subject ?? "general");
  const candidates = await collectChapterMediaCandidates(deps.root, chapterInput, sources, subject);
  const chapter = candidates.chapter;
  const issues = interactivePlanIssues(chapter.visuals);
  if (issues.length) throw new Error(`${chapter.title}: ${issues.join("; ")}`);
  const prior = await readMediaBrief(deps.root, set, chapter);
  const brief: MediaBrief = {
    chapter: chapter.title,
    scope: chapter.scope,
    refinedAt: new Date().toISOString(),
    ...(noInteractiveReason(chapter.visuals) ? { noInteractiveReason: noInteractiveReason(chapter.visuals) } : {}),
    visuals: candidates.visuals,
    figures: candidates.figures,
    tables: candidates.tables,
    images: candidates.images,
    video: {
      intent: chapter.video,
      status: "none",
      reason: "No suitable video passed authority, relevance, language and level checks.",
    },
  };
  // Reuse a still-registered chosen video when intent/scope are unchanged; refresh its actual transcript moment.
  const previousSource = prior?.video.sourceId ? await readSource(deps.root, prior.video.sourceId) : null;
  const observed = previousSource?.parsedFiles.length
    ? await sourcePassages(deps.root, [previousSource.source.id])
    : [];
  const observedAnchors = new Set(observed.map((p) => p.anchor));
  const priorRangeEnd = prior?.video.moment ? /–(\d+)s$/.exec(prior.video.moment)?.[1] : undefined;
  const priorMomentValid =
    previousSource?.parsedFiles.length === 0 ||
    (!!prior?.video.anchor &&
      observedAnchors.has(prior.video.anchor) &&
      (!priorRangeEnd || observedAnchors.has(`t${priorRangeEnd}`)));
  if (
    priorMomentValid &&
    prior?.scope === chapter.scope &&
    prior.video.intent === chapter.video &&
    prior.video.status === "chosen" &&
    previousSource?.source.type === "video" &&
    previousSource.source.url === prior.video.url
  ) {
    brief.video = { ...prior.video, watchOnly: previousSource.parsedFiles.length === 0 };
  } else if (chapter.video || chapter.visuals.length) {
    ctx.progress(`Choosing video for ${chapter.title}`);
    const classifier = await workspaceClassifier(deps.root, deps.runtime, ctx.signal, ctx);
    const frontmatter = parseFrontmatter(plan).frontmatter;
    const search = configuredSearch(
      deps.root,
      (exaRequests, exaCostUsd) => ctx.addUsage({ exaRequests, exaCostUsd }),
      {
        subject: String(frontmatter.subject ?? "general"),
        planText: plan,
        brief: `${chapter.title}\n${chapter.scope}\n${chapter.video}`,
      },
      deps.mcp,
    );
    const passed = new Set<string>();
    const scout = scoutSourcesTool({
      root: deps.root,
      classifier,
      search,
      onSelected: (items) => {
        for (const c of items) if (c.type === "video" && c.score >= 4) passed.add(c.url);
      },
    });
    // Existing linked videos are candidates too, but still require explicit quality judgment below.
    for (const id of sources) {
      const source = await readSource(deps.root, id);
      if (source?.source.type === "video" && source.source.url) passed.add(source.source.url);
    }
    const choose = defineTool({
      name: "choose_chapter_video",
      label: "Choose chapter video",
      description:
        "Choose one evaluated high-quality video or record why none fits. Ingests through the transcript ladder and returns real transcript passages for moment selection.",
      parameters: Type.Object({
        url: Type.Optional(Type.String()),
        channel: Type.Optional(Type.String()),
        reason: Type.String(),
        language: Type.Optional(Type.String()),
        levelFit: Type.Optional(Type.Boolean()),
        durationSeconds: Type.Optional(Type.Number({ minimum: 1 })),
        momentStart: Type.Optional(Type.Integer({ minimum: 0 })),
      }),
      executionMode: "sequential" as const,
      async execute(_id, params) {
        if (!params.url) {
          if (!params.reason.trim()) throw new Error("Give a concrete reason when no suitable video is chosen");
          brief.video = { intent: chapter.video, status: "none", reason: params.reason };
          return { content: [{ type: "text" as const, text: "Recorded no suitable video." }], details: {} };
        }
        if (
          !passed.has(params.url) ||
          !isWatchVideo(params.url, params.channel ?? "") ||
          !params.channel?.trim() ||
          !params.reason.trim() ||
          !params.levelFit ||
          !params.language?.trim()
        )
          throw new Error(
            "Choose a scout-evaluated watch URL with named educator/channel, quality reason, language and level fit.",
          );
        const requestedLanguage = typeof frontmatter.language === "string" ? frontmatter.language : "English";
        if (params.language.toLowerCase() !== requestedLanguage.toLowerCase())
          throw new Error(`Video language must fit ${requestedLanguage}`);
        if (
          params.durationSeconds &&
          (params.durationSeconds < 180 || params.durationSeconds > 1500) &&
          params.momentStart === undefined
        )
          throw new Error("Choose a focused moment for a video outside the preferred 3–25 minute range.");
        const result = await createIngestJob(deps)({ url: params.url, set }, { ...ctx, setTitle: () => {} });
        const view = result?.sourceId ? await readSource(deps.root, result.sourceId) : null;
        if (!view) throw new Error("Chosen video could not be registered");
        if (view.parsedFiles.length && !sources.includes(view.source.id)) sources.push(view.source.id);
        brief.video = {
          intent: chapter.video,
          status: "chosen",
          sourceId: view.source.id,
          title: view.source.title,
          channel: view.source.authors.join(", ") || params.channel,
          url: view.source.url ?? params.url,
          reason: params.reason,
          watchOnly: view.parsedFiles.length === 0,
        };
        const transcript = rankPassages(
          await sourcePassages(deps.root, [view.source.id]),
          `${chapter.title} ${chapter.scope} ${chapter.video}`,
        )
          .filter((p) => /^t\d+$/.test(p.anchor))
          .slice(0, 12);
        return {
          content: [
            {
              type: "text" as const,
              text: selectedPassage(
                JSON.stringify({
                  video: brief.video,
                  moments: transcript.map((p) => ({ anchor: p.anchor, text: p.text })),
                }),
                "Chosen video and observed transcript markers; choose an aligned real moment if present, never invent timestamps",
              ),
            },
          ],
          details: {},
        };
      },
    });
    const moment = defineTool({
      name: "choose_video_moment",
      label: "Choose transcript moment",
      description:
        "Choose a real registered tN transcript anchor and optional real end anchor, at most 180 seconds later.",
      parameters: Type.Object({ anchor: Type.String(), endAnchor: Type.Optional(Type.String()) }),
      async execute(_id, params) {
        if (!brief.video.sourceId || brief.video.watchOnly) throw new Error("No registered transcript is available");
        const transcript = await sourcePassages(deps.root, [brief.video.sourceId]);
        const anchors = new Set(transcript.map((p) => p.anchor).filter((anchor) => /^t\d+$/.test(anchor)));
        if (!anchors.has(params.anchor) || (params.endAnchor && !anchors.has(params.endAnchor)))
          throw new Error("Moment must use observed transcript anchors");
        const start = Number(params.anchor.slice(1)),
          end = params.endAnchor ? Number(params.endAnchor.slice(1)) : undefined;
        if (end !== undefined && (end <= start || end - start > 180))
          throw new Error("Moment range must be positive and at most 180 seconds");
        brief.video.anchor = params.anchor;
        brief.video.moment = end === undefined ? `${start}s` : `${start}–${end}s`;
        return { content: [{ type: "text" as const, text: "Recorded observed transcript moment." }], details: {} };
      },
    });
    const result = await runRole("outliner", {
      ...deps,
      set,
      jobContext: ctx,
      search,
      signal: ctx.signal,
      canWrite: () => false,
      onModel: (provider) => ctx.useProvider?.(provider),
      extraTools: [scout, choose, moment],
      task: [
        "Choose at least one high-quality video for this approved chapter. No file writes, no proposal. Use search slot video (M13 Exa → SearXNG youtube), then scout_sources with scored candidates. Prefer named educators/institutions or established educational channels, English unless PLAN requests another language, requested level, 3–25 minutes or a focused moment.",
        "Rank authority, relevance and level; score >=4 required. Use known metadata only; unknown duration/captions stay unknown. Then call choose_chapter_video with channel, language, levelFit and quality reason. If nothing passes, call it without url with one short learner-facing sentence explaining the authority, language, level or coverage gap; omit tool/provider names and internal scores. Never add a weak quota filler.",
        "After choosing, inspect the returned transcript passages and call choose_video_moment with a semantically aligned real tN anchor (optional real end anchor <=180s). If transcript is unavailable, the video is watch-only: no invented timestamps or evidence citations.",
        selectedPassage(
          JSON.stringify({
            title: chapter.title,
            scope: chapter.scope,
            videoNeed: chapter.video,
            level: frontmatter.level ?? 1,
            language: frontmatter.language ?? "English",
            linkedSources: sources,
          }),
          "chapter video requirements",
        ),
      ].join("\n"),
    }).catch(rethrowRoleModelError);
    ctx.addUsage(usageFromPiMessages(result.messages));
    if (brief.video.status === "chosen" && !brief.video.watchOnly && !brief.video.anchor) {
      brief.video = {
        intent: chapter.video,
        status: "none",
        reason: "The candidate had a transcript, but no aligned observed moment was selected.",
      };
    }
  }
  const selectedImages = await refineChapterImages(deps, set, chapter, candidates.figures, subject, ctx);
  brief.images = selectedImages.images;
  const weights = figureRelevanceWeights({
    title: chapter.title,
    scope: chapter.scope,
    visuals: chapter.visuals,
    video: chapter.video,
  });
  return saveMediaBrief(deps.root, deps.locks, set, chapter, brief, {
    images: selectedImages.candidates,
    figures: candidates.figures.map((figure) => ({ ...figure, score: figureRelevance(figure, weights) })),
  });
}

export async function prepareSetMedia(
  deps: DraftJobDeps,
  set: string,
  sources: string[],
  ctx: JobContext,
): Promise<void> {
  const curriculum = await readText(deps.root, `${set}/curriculum.md`);
  for (const chapter of parseCurriculum(curriculum)) {
    ctx.signal.throwIfAborted();
    await refineMediaBrief(deps, set, chapter, [...sources], ctx);
  }
}
