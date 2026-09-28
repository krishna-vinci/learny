import { promises as fs } from "node:fs";
import type { Context } from "hono";
import { Hono } from "hono";
import type { EventHub } from "../events.js";
import { diff, log, RevertConflictError, revert } from "../tree/git.js";
import { PathError, resolveInRoot } from "../tree/paths.js";
import { isSetSlug, listNotes, listSets, readSetFile } from "../tree/read.js";

export interface SetsDeps {
  root: string;
  hub: EventHub;
}

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 500;

function notFound(c: Context): Response {
  return c.json({ error: "not found" }, 404);
}

function invalidPath(c: Context): Response {
  return c.json({ error: "invalid path" }, 400);
}

async function setExists(root: string, set: string): Promise<boolean> {
  if (!isSetSlug(set)) return false;
  try {
    const stats = await fs.stat(resolveInRoot(root, set));
    return stats.isDirectory();
  } catch {
    return false;
  }
}

// Set-relative request path -> study-root-relative path, or null when it escapes.
function rootRelativePath(root: string, set: string, rel: string): string | null {
  try {
    resolveInRoot(root, `${set}/${rel}`);
    return `${set}/${rel}`;
  } catch (error) {
    if (error instanceof PathError) return null;
    throw error;
  }
}

function parseLimit(raw: string | undefined): number {
  if (raw === undefined) return DEFAULT_HISTORY_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_HISTORY_LIMIT;
  return Math.min(parsed, MAX_HISTORY_LIMIT);
}

async function readJsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await c.req.json();
    if (typeof body === "object" && body !== null && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
  } catch {
    // fall through to an empty body
  }
  return {};
}

export function setsRoutes(deps: SetsDeps): Hono {
  const { root, hub } = deps;
  const app = new Hono();

  app.get("/", async (c) => c.json(await listSets(root)));

  app.get("/:set/notes", async (c) => {
    const set = c.req.param("set");
    if (!(await setExists(root, set))) return notFound(c);
    return c.json(await listNotes(root, set));
  });

  app.get("/:set/file", async (c) => {
    const set = c.req.param("set");
    const rel = c.req.query("path");
    if (rel === undefined || rel === "") return c.json({ error: "path is required" }, 400);
    if (!(await setExists(root, set))) return notFound(c);

    try {
      const view = await readSetFile(root, set, rel);
      if (view === null) return notFound(c);
      return c.json(view);
    } catch (error) {
      if (error instanceof PathError) return invalidPath(c);
      throw error;
    }
  });

  app.get("/:set/history", async (c) => {
    const set = c.req.param("set");
    if (!(await setExists(root, set))) return notFound(c);

    const rel = c.req.query("path");
    const target = rel === undefined || rel === "" ? null : rootRelativePath(root, set, rel);
    if (rel !== undefined && rel !== "" && target === null) return invalidPath(c);

    const limit = parseLimit(c.req.query("limit"));
    return c.json(await log(root, target === null ? { limit } : { limit, path: target }));
  });

  app.get("/:set/diff", async (c) => {
    const set = c.req.param("set");
    if (!(await setExists(root, set))) return notFound(c);

    const sha = c.req.query("sha");
    if (sha === undefined || sha === "") return c.json({ error: "sha is required" }, 400);

    const rel = c.req.query("path");
    const target = rel === undefined || rel === "" ? null : rootRelativePath(root, set, rel);
    if (rel !== undefined && rel !== "" && target === null) return invalidPath(c);

    try {
      const patch = await diff(root, sha, target ?? undefined);
      return c.json({ diff: patch });
    } catch {
      return c.json({ error: "diff failed" }, 400);
    }
  });

  app.post("/:set/revert", async (c) => {
    const set = c.req.param("set");
    if (!(await setExists(root, set))) return notFound(c);

    const body = await readJsonBody(c);
    const sha = typeof body.sha === "string" && body.sha !== "" ? body.sha : null;
    if (sha === null) return c.json({ error: "sha is required" }, 400);

    try {
      const newSha = await revert(root, sha, "user");
      const head = (await log(root, { limit: 1 }))[0];
      if (head !== undefined) {
        hub.publish({ type: "commit", sha: head.sha, subject: head.subject, author: head.author });
      }
      return c.json({ sha: newSha });
    } catch (error) {
      if (error instanceof RevertConflictError) return c.json({ error: "revert conflict" }, 409);
      return c.json({ error: "revert failed" }, 400);
    }
  });

  return app;
}
