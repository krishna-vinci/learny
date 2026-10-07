import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { PlanFrontmatter, parseFrontmatter } from "@studium/shared";
import { rethrowRoleModelError, runRole } from "../agent/run-role.js";
import { parsePlanProposal, SOURCE_ID, validDeadline } from "../inbox/plans.js";
import { interactivePlanIssues, parseCurriculum } from "../tree/curriculum.js";
import { readText } from "../tree/edit.js";
import { commitPaths } from "../tree/git.js";
import { resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";
import type { DraftJobDeps } from "./draft-job.js";
import { prepareSetMedia } from "./media-plan.js";
import { type JobHandler, usageFromPiMessages } from "./runner.js";

export interface PlanSetInput {
  set: string;
  goal: string;
  mode?: "change";
  level?: number;
  deadline?: string;
  sources?: string[];
}

export function parsePlanSetInput(value: unknown): PlanSetInput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("invalid plan-set input");
  const input = value as Record<string, unknown>;
  if (typeof input.set !== "string" || !isSetSlug(input.set)) throw new Error("invalid set");
  if (typeof input.goal !== "string" || !input.goal.trim()) throw new Error("goal is required");
  if (
    input.level !== undefined &&
    (typeof input.level !== "number" || !Number.isInteger(input.level) || input.level < 1 || input.level > 5)
  )
    throw new Error("level must be 1–5");
  if (input.deadline !== undefined && (typeof input.deadline !== "string" || !validDeadline(input.deadline)))
    throw new Error("deadline must be YYYY-MM-DD");
  if (
    input.sources !== undefined &&
    (!Array.isArray(input.sources) ||
      !input.sources.every((source) => typeof source === "string" && SOURCE_ID.test(source)))
  )
    throw new Error("sources must contain library source ids");
  if (input.mode !== undefined && input.mode !== "change") throw new Error("mode must be change");
  return {
    ...(input.mode === "change" ? { mode: "change" as const } : {}),
    set: input.set,
    goal: input.goal.trim(),
    ...(input.level === undefined ? {} : { level: input.level as number }),
    ...(input.deadline === undefined ? {} : { deadline: input.deadline as string }),
    ...(input.sources === undefined ? {} : { sources: [...(input.sources as string[])] }),
  };
}

export function validateMediaIntent(curriculum: string): void {
  for (const chapter of parseCurriculum(curriculum)) {
    if ((chapter.images?.length ?? 0) > 3)
      throw new Error(`Chapter ${chapter.title} must plan at most three real image slots`);
    if (chapter.visuals.length > 20 || !chapter.video || interactivePlanIssues(chapter.visuals).length)
      throw new Error(
        `Chapter ${chapter.title} needs at least one interactive Visual intent with form and concept (two for two useful central concepts), or no interactive visual: <concrete reason>, and a Video need or no-suitable-video reason`,
      );
  }
}

export function createPlanJob(deps: DraftJobDeps): JobHandler {
  return async (rawInput, ctx) => {
    if (rawInput && typeof rawInput === "object" && "mediaOnly" in rawInput && rawInput.mediaOnly === true) {
      const request = rawInput as unknown as { set: string; sources: string[] };
      if (
        !isSetSlug(request.set) ||
        !Array.isArray(request.sources) ||
        !request.sources.every((id) => SOURCE_ID.test(id))
      )
        throw new Error("Invalid chapter media input");
      await prepareSetMedia(deps, request.set, request.sources, ctx);
      return {};
    }
    const input = parsePlanSetInput(rawInput);
    const currentPlan = PlanFrontmatter.parse(
      parseFrontmatter(await readText(deps.root, `${input.set}/PLAN.md`)).frontmatter,
    );
    const sources = input.sources ?? currentPlan.sources ?? [];
    for (const source of sources) {
      if (!SOURCE_ID.test(source)) throw new Error("PLAN.md contains an invalid source id");
      await readText(deps.root, `library/${source}/source.md`);
    }
    const proposalPath = `plan-proposals/${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.md`;
    const proposalRoot = `${input.set}/${proposalPath}`;
    return deps.locks.withLock(`${input.set}/plan-proposals`, `outliner:${randomUUID()}`, async () => {
      let committed = false;
      try {
        ctx.signal.throwIfAborted();
        ctx.progress(input.mode === "change" ? "Proposing a small plan change" : "Planning study set");
        const result = await runRole("outliner", {
          jobContext: ctx,
          ...deps,
          set: input.set,
          task: [
            "Load plan-set and find-sources. Read the learner profile and selected library sources, then propose a study plan.",
            input.mode === "change"
              ? `SMALL CHANGE MODE: Load the small-change instructions in plan-set. Read current PLAN.md and curriculum.md. Make the smallest change satisfying the learner request. Preserve every unrelated chapter title, order, scope, prerequisites, checkbox ticks and media lines. Keep PLAN.md unchanged unless the request requires a plan-text change. Do not apply new-course media requirements to unchanged legacy chapters. Request: ${input.goal}`
              : `Goal: ${input.goal}`,
            `Level: ${input.level ?? currentPlan.level ?? 1}`,
            `Deadline: ${input.deadline ?? currentPlan.deadline ?? "none"}`,
            `Chosen library source ids: ${sources.join(", ") || "(none)"}`,
            `Create exactly ${proposalPath}, with the skill's two labeled fences and Sources to add list.`,
            input.mode === "change"
              ? "Only adjust media lines explicitly requested or needed for changed/new chapters. Preserve all other chapter media lines."
              : "Every chapter needs at least one interactive Visual: <form> — <concept; learner action> line, two when two central concepts benefit from manipulation/stepping, in addition to static figures/charts. Use function-plot, matrix-transform, step-through or timeline widget, sketch or story from make-visual. A rare exception must say Visual: no interactive visual: <concrete pedagogical reason>. Add 1–3 Image: <real object, material, organism, monument, photograph or source diagram; what the learner should notice> lines wherever seeing the real thing teaches; omit image slots when diagrams alone teach better. Do not use Image slots for generated SVGs. Include a Video: <need or no-suitable-video reason> line. Refine these after source ingestion; do not silently omit media intent.",
            "Use only the chosen registered ids in PLAN.md sources. Propose other sources as URLs; never register them.",
            "Do not edit the current plan, curriculum, notes, or any other file.",
          ].join("\n"),
          canWrite: (rel) => rel === proposalRoot,
          signal: ctx.signal,
          onModel: (provider) => ctx.useProvider?.(provider),
          onFallback: (_from, to) => ctx.progress(`Outliner model rate-limited; using ${to}`),
        }).catch(rethrowRoleModelError);
        ctx.addUsage(usageFromPiMessages(result.messages));
        if (result.written.length !== 1 || result.written[0] !== proposalRoot)
          throw new Error(`outliner must create exactly ${proposalPath}`);
        ctx.signal.throwIfAborted();
        const subject = "outliner: propose plan";
        const commitSha = await commitPaths(deps.root, [proposalRoot], subject, "outliner");
        if (commitSha === null) throw new Error("plan job produced no changes to commit");
        committed = true;
        deps.hub.publish({ type: "commit", sha: commitSha, subject, author: "outliner" });
        // Preserve completed agent output even if validation fails, so it can be discarded.
        const proposal = parsePlanProposal(await readText(deps.root, proposalRoot));
        if (input.mode !== "change") validateMediaIntent(proposal.curriculum);
        const proposedSources = PlanFrontmatter.parse(parseFrontmatter(proposal.plan).frontmatter).sources ?? [];
        if (proposedSources.some((source) => !sources.includes(source)))
          throw new Error("proposal uses an unchosen source id");
        ctx.progress("Plan awaiting approval");
        return { proposalPath, commitSha };
      } catch (error) {
        // A cancelled/failed run's uncommitted partial file is not an Inbox proposal.
        if (!committed) await fs.unlink(resolveInRoot(deps.root, proposalRoot)).catch(() => undefined);
        throw error;
      }
    });
  };
}
