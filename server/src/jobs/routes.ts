import { Hono } from "hono";
import { parseDraftChapterInput } from "./draft-job.js";
import { jobProposals, type ProposalStore } from "./proposals.js";
import type { JobRunner } from "./runner.js";

export interface JobsRoutesDeps {
  runner: JobRunner;
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
      } else if (!(typeof body === "object" && body !== null && "kind" in body && body.kind === "draft-chapter")) {
        throw new Error('kind must be "draft-chapter"');
      }
      const parsed = parseDraftChapterInput(input);
      const job = deps.runner.enqueue("draft-chapter", parsed, { set: parsed.set, title: parsed.title });
      return c.json({ jobId: job.id }, 202);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
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
