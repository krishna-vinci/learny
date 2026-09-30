import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { PlanFrontmatter, parseFrontmatter } from "@studium/shared";
import { rethrowRoleModelError, runRole } from "../agent/run-role.js";
import { parsePlanProposal, SOURCE_ID, validDeadline } from "../inbox/plans.js";
import { readText } from "../tree/edit.js";
import { commitPaths } from "../tree/git.js";
import { resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";
import type { DraftJobDeps } from "./draft-job.js";
import { type JobHandler, usageFromPiMessages } from "./runner.js";

export interface PlanSetInput {
  set: string;
  goal: string;
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
  return {
    set: input.set,
    goal: input.goal.trim(),
    ...(input.level === undefined ? {} : { level: input.level as number }),
    ...(input.deadline === undefined ? {} : { deadline: input.deadline as string }),
    ...(input.sources === undefined ? {} : { sources: [...(input.sources as string[])] }),
  };
}

export function createPlanJob(deps: DraftJobDeps): JobHandler {
  return async (rawInput, ctx) => {
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
        ctx.progress("Planning study set");
        const result = await runRole("outliner", {
          ...deps,
          set: input.set,
          task: [
            "Load plan-set and find-sources. Read the learner profile and selected library sources, then propose a study plan.",
            `Goal: ${input.goal}`,
            `Level: ${input.level ?? currentPlan.level ?? 1}`,
            `Deadline: ${input.deadline ?? currentPlan.deadline ?? "none"}`,
            `Chosen library source ids: ${sources.join(", ") || "(none)"}`,
            `Create exactly ${proposalPath}, with the skill's two labeled fences and Sources to add list.`,
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
