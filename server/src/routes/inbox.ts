import { promises as fs } from "node:fs";
import path from "node:path";
import { PlanFrontmatter, parseFrontmatter } from "@studium/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import type { EventHub } from "../events.js";
import { parsePlanProposal, proposalRootPath } from "../inbox/plans.js";
import { readInbox } from "../inbox/read.js";
import { AiDisabledError, type JobRunner } from "../jobs/runner.js";
import { parseCurriculum } from "../tree/curriculum.js";
import { editFile, readText, writeTextLocked } from "../tree/edit.js";
import { commitPaths } from "../tree/git.js";
import type { FileLocks } from "../tree/lock.js";
import { canonicalRel, resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";

export { parseCheckReport } from "../inbox/read.js";

export interface InboxRoutesDeps {
  root: string;
  locks: FileLocks;
  hub: EventHub;
  jobs?: Pick<JobRunner, "enqueue"> & Partial<Pick<JobRunner, "assertAiAllowed">>;
}

const NOTE_PATH = /^notes\/[0-9]{2,}-[a-z0-9][a-z0-9-]*\.md$/;

function notFound(c: Context): Response {
  return c.json({ error: "not found" }, 404);
}

function proposalError(c: Context, error: unknown): Response {
  if (error instanceof AiDisabledError) return c.json({ error: error.message }, 403);
  if (error instanceof Error && "code" in error && (error.code === "not_found" || error.code === "ENOENT"))
    return notFound(c);
  return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
}

async function optionalText(root: string, rel: string): Promise<string | null> {
  try {
    return await readText(root, rel);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "not_found") return null;
    throw error;
  }
}

async function setExists(root: string, set: string): Promise<boolean> {
  if (!isSetSlug(set)) return false;
  try {
    return (await fs.stat(resolveInRoot(root, set))).isDirectory();
  } catch {
    return false;
  }
}

function frontmatterStatusLine(text: string): { line: string; status: string } {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (block?.[1] === undefined) throw new Error("note has no valid frontmatter block");
  const matches = block[1].match(/^status:\s*([^\r\n]+)$/gm) ?? [];
  if (matches.length !== 1 || matches[0] === undefined) throw new Error("note must have exactly one status line");
  const status = matches[0].slice(matches[0].indexOf(":") + 1).trim();
  return { line: matches[0], status };
}

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const value: unknown = await c.req.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

export function inboxRoutes(deps: InboxRoutesDeps): Hono {
  const app = new Hono();

  app.get("/plan-proposals/:file", async (c) => {
    const set = c.req.param("set");
    if (set === undefined || !(await setExists(deps.root, set))) return notFound(c);
    try {
      const rel = proposalRootPath(deps.root, set, c.req.param("file"));
      return c.json(parsePlanProposal(await readText(deps.root, rel)));
    } catch (error) {
      return proposalError(c, error);
    }
  });

  app.post("/plan-proposals/:file/approve", async (c) => {
    const set = c.req.param("set");
    if (set === undefined || !(await setExists(deps.root, set))) return notFound(c);
    try {
      const text = await c.req.text();
      const body: unknown = text === "" ? {} : JSON.parse(text);
      if (typeof body !== "object" || body === null || Array.isArray(body)) throw new Error("invalid approval body");
      const draftFirst = "draftFirst" in body ? body.draftFirst : 3;
      if (typeof draftFirst !== "number" || !Number.isInteger(draftFirst) || draftFirst < 0 || draftFirst > 5)
        throw new Error("draftFirst must be 0–5");
      if (draftFirst > 0 && deps.jobs === undefined) return c.json({ error: "job runner unavailable" }, 503);
      if (draftFirst > 0) deps.jobs?.assertAiAllowed?.("draft-chapter");
      const rel = proposalRootPath(deps.root, set, c.req.param("file"));
      const planRel = `${set}/PLAN.md`;
      const curriculumRel = `${set}/curriculum.md`;
      const holder = `user:approve-plan:${crypto.randomUUID()}`;
      return await deps.locks.withLock(`${set}/plan-proposals`, holder, () =>
        deps.locks.withLock(rel, holder, () =>
          deps.locks.withLock(planRel, holder, () =>
            deps.locks.withLock(curriculumRel, holder, async () => {
              const proposalText = await readText(deps.root, proposalRootPath(deps.root, set, c.req.param("file")));
              const proposal = parsePlanProposal(proposalText);
              const sources = PlanFrontmatter.parse(parseFrontmatter(proposal.plan).frontmatter).sources ?? [];
              for (const source of sources) await readText(deps.root, `library/${source}/source.md`);
              // Check both targets before writing either; forbid aliases into other tree files.
              for (const target of [planRel, curriculumRel]) {
                if (canonicalRel(deps.root, target) !== target) throw new Error("plan target symlinks are not allowed");
              }
              const previousPlan = await readText(deps.root, planRel);
              const previousCurriculum = await optionalText(deps.root, curriculumRel);
              const canWrite = (candidate: string) => candidate === planRel || candidate === curriculumRel;
              // Recheck immediately before mutations, after asynchronous validation.
              if (draftFirst > 0) deps.jobs?.assertAiAllowed?.("draft-chapter");
              let deleted = false;
              const subject = "user: approve plan";
              let sha: string | null;
              try {
                await writeTextLocked(deps.root, deps.locks, holder, planRel, proposal.plan, canWrite);
                await writeTextLocked(deps.root, deps.locks, holder, curriculumRel, proposal.curriculum, canWrite);
                await fs.unlink(resolveInRoot(deps.root, rel));
                deleted = true;
                sha = await commitPaths(deps.root, [planRel, curriculumRel, rel], subject, "user");
                if (sha === null) throw new Error("nothing to approve");
              } catch (error) {
                await writeTextLocked(deps.root, deps.locks, holder, planRel, previousPlan, canWrite);
                if (previousCurriculum === null)
                  await fs.unlink(resolveInRoot(deps.root, curriculumRel)).catch(() => undefined);
                else await writeTextLocked(deps.root, deps.locks, holder, curriculumRel, previousCurriculum, canWrite);
                if (deleted)
                  await writeTextLocked(
                    deps.root,
                    deps.locks,
                    holder,
                    rel,
                    proposalText,
                    (candidate) => candidate === rel,
                  );
                throw error;
              }
              deps.hub.publish({ type: "commit", sha, subject, author: "user" });
              const jobIds = parseCurriculum(proposal.curriculum)
                .filter((chapter) => !chapter.checked)
                .slice(0, draftFirst)
                .map((chapter) => {
                  const job = deps.jobs?.enqueue(
                    "draft-chapter",
                    { set, title: chapter.title, brief: chapter.scope, sources },
                    { set, title: chapter.title },
                  );
                  return job?.id;
                });
              return c.json({ sha, jobIds });
            }),
          ),
        ),
      );
    } catch (error) {
      return proposalError(c, error);
    }
  });

  app.post("/plan-proposals/:file/discard", async (c) => {
    const set = c.req.param("set");
    if (set === undefined || !(await setExists(deps.root, set))) return notFound(c);
    try {
      const rel = proposalRootPath(deps.root, set, c.req.param("file"));
      const holder = `user:discard-plan:${crypto.randomUUID()}`;
      return await deps.locks.withLock(`${set}/plan-proposals`, holder, () =>
        deps.locks.withLock(rel, holder, async () => {
          const previous = await readText(deps.root, proposalRootPath(deps.root, set, c.req.param("file")));
          const subject = "user: discard plan";
          await fs.unlink(resolveInRoot(deps.root, rel));
          let sha: string | null;
          try {
            sha = await commitPaths(deps.root, [rel], subject, "user");
          } catch (error) {
            await writeTextLocked(deps.root, deps.locks, holder, rel, previous, (candidate) => candidate === rel);
            throw error;
          }
          if (sha !== null) deps.hub.publish({ type: "commit", sha, subject, author: "user" });
          return c.json({ sha });
        }),
      );
    } catch (error) {
      return proposalError(c, error);
    }
  });

  app.get("/inbox", async (c) => {
    const set = c.req.param("set");
    if (set === undefined) return notFound(c);
    if (!(await setExists(deps.root, set))) return notFound(c);
    return c.json(await readInbox(deps.root, set));
  });

  app.post("/notes/accept", async (c) => {
    const set = c.req.param("set");
    if (set === undefined) return notFound(c);
    if (!(await setExists(deps.root, set))) return notFound(c);
    const body = await jsonBody(c);
    const notePath = typeof body.path === "string" ? body.path : "";
    if (!NOTE_PATH.test(notePath) || path.posix.normalize(notePath) !== notePath) {
      return c.json({ error: "invalid note path" }, 400);
    }
    const noteRootPath = `${set}/${notePath}`;
    let note: string;
    try {
      note = await fs.readFile(resolveInRoot(deps.root, noteRootPath), "utf8");
    } catch {
      return notFound(c);
    }
    let current: { line: string; status: string };
    try {
      current = frontmatterStatusLine(note);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
    if (current.status !== "draft" && current.status !== "checked") {
      return c.json({ error: "note is not awaiting acceptance" }, 409);
    }
    await editFile(
      deps.root,
      deps.locks,
      `user:accept:${crypto.randomUUID()}`,
      noteRootPath,
      current.line,
      "status: accepted",
      {
        canWrite: (candidate) => candidate === noteRootPath,
      },
    );
    const subject = `user: accept ${notePath}`;
    const sha = await commitPaths(deps.root, [noteRootPath], subject, "user");
    if (sha === null) return c.json({ error: "nothing to accept" }, 409);
    deps.hub.publish({ type: "commit", sha, subject, author: "user" });
    return c.json({ sha });
  });

  return app;
}
