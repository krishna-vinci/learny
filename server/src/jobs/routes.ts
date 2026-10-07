import { existsSync } from "node:fs";
import { Hono } from "hono";
import type { EventHub } from "../events.js";
import { createSet } from "../tree/authoring.js";
import { resolveInRoot } from "../tree/paths.js";
import { parseCompileBookInput } from "./book-paths.js";
import { parseMakeCardsInput } from "./cards-job.js";
import { parseDraftChapterInput, parseRewriteChapterInput } from "./draft-job.js";
import { parsePlanSetInput } from "./plan-job.js";
import { parseMakeProblemsInput, parseMakeQuizInput } from "./practice-job.js";
import { jobProposals, type ProposalStore } from "./proposals.js";
import { AiDisabledError, type JobRunner } from "./runner.js";

export interface JobsRoutesDeps {
  runner: JobRunner;
  /** Study root; when set, make-cards requests for a missing note are rejected up front. */
  root?: string;
  hub?: EventHub;
  proposals?: ProposalStore;
}

export function jobsRoutes(deps: JobsRoutesDeps): Hono {
  const app = new Hono();

  app.post("/", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid JSON body" }, 400);
    }
    try {
      let input: unknown = body;
      if (typeof body === "object" && body !== null && "proposalId" in body) {
        const proposalId = body.proposalId;
        if (typeof proposalId !== "string" || proposalId === "") throw new Error("proposalId is required");
        input = (deps.proposals ?? jobProposals).take(proposalId);
        if (input === null) return c.json({ error: "proposal not found or expired" }, 404);
      } else if (
        !(
          typeof body === "object" &&
          body !== null &&
          "kind" in body &&
          (body.kind === "draft-chapter" ||
            body.kind === "rewrite-chapter" ||
            body.kind === "make-cards" ||
            body.kind === "compile-book" ||
            body.kind === "plan-set" ||
            body.kind === "make-quiz" ||
            body.kind === "make-problems")
        )
      ) {
        throw new Error(
          'kind must be "draft-chapter", "rewrite-chapter", "make-cards", "compile-book", "plan-set", "make-quiz" or "make-problems"',
        );
      }
      if (
        typeof input === "object" &&
        input !== null &&
        "kind" in input &&
        (input.kind === "make-quiz" || input.kind === "make-problems")
      ) {
        const parsed = input.kind === "make-quiz" ? parseMakeQuizInput(input) : parseMakeProblemsInput(input);
        if (deps.root === undefined) throw new Error("study root is required for practice");
        if (!existsSync(resolveInRoot(deps.root, `${parsed.set}/PLAN.md`)))
          return c.json({ error: "set not found" }, 404);
        for (const note of "note" in parsed ? [parsed.note] : (parsed.notes ?? [])) {
          if (!existsSync(resolveInRoot(deps.root, `${parsed.set}/${note}`)))
            return c.json({ error: `note not found: ${note}` }, 404);
        }
        const job = deps.runner.enqueue(input.kind, parsed, {
          set: parsed.set,
          title:
            input.kind === "make-quiz"
              ? "Practice quiz"
              : `Problems for ${"note" in parsed ? parsed.note : parsed.set}`,
        });
        return c.json({ jobId: job.id }, 202);
      }
      if (typeof input === "object" && input !== null && "kind" in input && input.kind === "plan-set") {
        const parsed = parsePlanSetInput(input);
        deps.runner.assertAiAllowed("plan-set");
        if (deps.root === undefined) throw new Error("study root is required for plan-set");
        for (const source of parsed.sources ?? []) {
          if (!existsSync(resolveInRoot(deps.root, `library/${source}/source.md`)))
            throw new Error(`source not found: ${source}`);
        }
        if (!existsSync(resolveInRoot(deps.root, `${parsed.set}/PLAN.md`))) {
          if (parsed.mode === "change") return c.json({ error: "set not found" }, 404);
          const created = await createSet(deps.root, { title: parsed.set, goal: parsed.goal });
          parsed.set = created.slug;
          if (created.sha !== null)
            deps.hub?.publish({ type: "commit", sha: created.sha, subject: created.subject, author: "user" });
        }
        const job = deps.runner.enqueue("plan-set", parsed, { set: parsed.set, title: `Plan: ${parsed.goal}` });
        return c.json({ jobId: job.id, set: parsed.set }, 202);
      }
      if (typeof input === "object" && input !== null && "kind" in input && input.kind === "make-cards") {
        const parsed = parseMakeCardsInput(input);
        if (deps.root !== undefined && !existsSync(resolveInRoot(deps.root, `${parsed.set}/${parsed.note}`))) {
          return c.json({ error: `note not found: ${parsed.note}` }, 404);
        }
        const job = deps.runner.enqueue("make-cards", parsed, {
          set: parsed.set,
          title: `Cards for ${parsed.note}`,
        });
        return c.json({ jobId: job.id }, 202);
      }
      if (typeof input === "object" && input !== null && "kind" in input && input.kind === "compile-book") {
        const parsed = parseCompileBookInput(input);
        if (deps.root !== undefined && !existsSync(resolveInRoot(deps.root, `${parsed.set}/PLAN.md`))) {
          return c.json({ error: "set not found" }, 404);
        }
        const job = deps.runner.enqueue("compile-book", parsed, { set: parsed.set, title: `Book for ${parsed.set}` });
        return c.json({ jobId: job.id }, 202);
      }
      if (typeof input === "object" && input !== null && "kind" in input && input.kind === "rewrite-chapter") {
        const parsed = parseRewriteChapterInput(input);
        if (deps.root === undefined) throw new Error("study root is required for rewrite-chapter");
        if (!existsSync(resolveInRoot(deps.root, `${parsed.set}/${parsed.path}`)))
          return c.json({ error: "note not found" }, 404);
        const job = deps.runner.enqueue("rewrite-chapter", parsed, { set: parsed.set, title: "Rewriting chapter" });
        return c.json({ jobId: job.id }, 202);
      }
      const parsed = parseDraftChapterInput(input);
      const job = deps.runner.enqueue("draft-chapter", parsed, { set: parsed.set, title: parsed.title });
      return c.json({ jobId: job.id }, 202);
    } catch (error) {
      return c.json(
        { error: error instanceof Error ? error.message : String(error) },
        error instanceof AiDisabledError ? 403 : 400,
      );
    }
  });

  app.get("/", (c) => {
    const set = c.req.query("set");
    return c.json(deps.runner.list(set === undefined || set === "" ? undefined : set));
  });

  app.post("/:id/cancel", (c) => {
    const id = c.req.param("id");
    if (deps.runner.get(id) === undefined) return c.json({ error: "not found" }, 404);
    if (!deps.runner.cancel(id)) return c.json({ error: "not cancellable" }, 409);
    return c.body(null, 204);
  });

  return app;
}
