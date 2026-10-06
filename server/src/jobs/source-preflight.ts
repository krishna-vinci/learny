import { parseFrontmatter } from "@studium/shared";
import { type ScoutedSource, scoutSourcesTool } from "../agent/builtins/scout-sources.js";
import { workspaceClassifier } from "../agent/classifier-workspace.js";
import { selectedPassage } from "../agent/passage.js";
import { rethrowRoleModelError, runRole } from "../agent/run-role.js";
import { readSource } from "../ingest/library.js";
import { configuredSearch } from "../search/backends.js";
import { chapterConcepts, measureCoverage, saveCoverage } from "../search/coverage.js";
import { sourcePassages } from "../search/passages.js";
import { chapterExists, interactivePlanIssues, parseCurriculum, withInteractiveFallback } from "../tree/curriculum.js";
import type { DraftJobDeps } from "./draft-job.js";
import { createIngestJob } from "./ingest-job.js";
import { refineMediaBrief } from "./media-plan.js";
import { type JobContext, usageFromPiMessages } from "./runner.js";

/** Run inline (never enqueue/wait inside a runner slot). Imported evidence still goes through the Librarian. */
export async function sourcePreflight(
  deps: DraftJobDeps,
  input: { set: string; title: string; brief?: string },
  plan: string,
  curriculum: string,
  initial: string[],
  ctx: JobContext,
) {
  const found = parseCurriculum(curriculum).find((c) => chapterExists(c, [{ path: "", title: input.title }]));
  const chapter =
    found && (found.visuals.length || found.video || found.images?.length)
      ? withInteractiveFallback(found, String(parseFrontmatter(plan).frontmatter.subject ?? "general"))
      : found;
  if (chapter && (chapter.visuals.length || chapter.video || chapter.images?.length)) {
    const issues = interactivePlanIssues(chapter.visuals);
    if (issues.length) throw new Error(`${chapter.title}: ${issues.join("; ")}`);
  }
  const scope = chapter?.scope || input.brief || "";
  const concepts = chapterConcepts(input.title, scope);
  let sources = [...initial];
  let coverage = measureCoverage(concepts, await sourcePassages(deps.root, sources));
  await saveCoverage(deps.root, input.set, input.title, scope, coverage);
  // Without a scoped concept list, the title-only match is informational, not a mandate to expand the set.
  if (coverage.weakest.length && scope) {
    ctx.progress("Finding evidence for chapter gaps");
    const classifier = await workspaceClassifier(deps.root, deps.runtime, ctx.signal, ctx);
    const selected = new Map<string, ScoutedSource>();
    const subject = String(parseFrontmatter(plan).frontmatter.subject ?? "general");
    const search = configuredSearch(
      deps.root,
      (exaRequests, exaCostUsd) => ctx.addUsage({ exaRequests, exaCostUsd }),
      {
        subject,
        planText: plan,
        brief: `${input.title}\n${scope}`,
      },
      deps.mcp,
    );
    const scout = scoutSourcesTool({
      root: deps.root,
      classifier,
      search,
      onSelected: (items) => {
        for (const s of items) selected.set(s.url, s);
      },
    });
    const level = parseFrontmatter(plan).frontmatter.level;
    const result = await runRole("outliner", {
      jobContext: ctx,
      search,
      ...deps,
      set: input.set,
      signal: ctx.signal,
      canWrite: () => false,
      task: [
        "Load find-sources and its references/recipes.md. Scout targeted evidence for the uncovered concepts below before this approved chapter drafts.",
        "Search 10–20 candidates per missing recipe slot, use scout_sources to evaluate the leaders. No file writes, no plan proposal, no add_source. The harness imports passed candidates through the Librarian.",
        `Level: ${typeof level === "number" ? level : 1}`,
        selectedPassage(JSON.stringify({ title: input.title, missing: coverage.weakest }), "chapter evidence gaps"),
        "Prefer textbook/OER + expert explainers. Papers only when the recipe permits. If video teaches the concept better, select named educator/institution individual videos; unknown captions/length stay unknown.",
        "If no usable source is found, report that honestly and stop this scouting turn.",
      ].join("\n"),
      extraTools: [scout],
      onModel: (p) => ctx.useProvider?.(p),
    }).catch(rethrowRoleModelError);
    ctx.addUsage(usageFromPiMessages(result.messages));
    const ingest = createIngestJob({
      ...deps,
      candidateImages: new Map([...selected.values()].map((c) => [c.url, c.images ?? []])),
    });
    for (const candidate of selected.values()) {
      ctx.signal.throwIfAborted();
      const added = await ingest({ url: candidate.url, set: input.set }, { ...ctx, setTitle: () => {} });
      if (added?.sourceId && (await readSource(deps.root, added.sourceId))?.parsedFiles.length)
        sources.push(added.sourceId);
    }
    sources = [...new Set(sources)];
    coverage = measureCoverage(concepts, await sourcePassages(deps.root, sources));
    await saveCoverage(deps.root, input.set, input.title, scope, coverage);
  }
  const mediaBrief =
    chapter && (chapter.visuals.length || chapter.video || chapter.images?.length)
      ? await refineMediaBrief(deps, input.set, chapter, sources, ctx)
      : null;
  return { sources, coverage, mediaBrief };
}
