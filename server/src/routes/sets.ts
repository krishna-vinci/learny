import { promises as fs } from "node:fs";
import type { Context } from "hono";
import { Hono } from "hono";
import { buildCourse } from "../course/build.js";
import type { EventHub } from "../events.js";
import { listSetSources } from "../ingest/library.js";
import type { JobRunner } from "../jobs/runner.js";
import { createNote, createSet, writeNoteAsUser, writePlanAsUser } from "../tree/authoring.js";
import { curriculumView } from "../tree/curriculum.js";
import { CurriculumEditRequest, editCurriculum } from "../tree/curriculum-edit.js";
import { DeletionError, deleteFromTree, previewDeletion, recentlyDeleted, restoreDeletion } from "../tree/deletion.js";
import { EditError, readText } from "../tree/edit.js";
import { changedPaths, diff, log, RevertConflictError, revert, revertPaths } from "../tree/git.js";
import { type FileLocks, SetMutationError } from "../tree/lock.js";
import { IMAGE_MIME, MEDIA_HEADERS } from "../tree/media.js";
import { canonicalRel, PathError, resolveInRoot } from "../tree/paths.js";
import { isSetSlug, listNotes, listSets, readSetFile } from "../tree/read.js";

export interface SetsDeps {
  root: string;
  hub: EventHub;
  locks: FileLocks;
  jobs?: Pick<JobRunner, "chapterJobs">;
  assertIdle?: (set: string) => void;
}

const DEFAULT_HISTORY_LIMIT = 50;
const MAX_HISTORY_LIMIT = 500;
const MAX_NOTE_BYTES = 1024 * 1024;
const NOTE_PATH = /^notes\/[a-z0-9][a-z0-9._-]*\.md$/;

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
    await fs.access(`${resolveInRoot(root, set)}/PLAN.md`);
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
  const { root, hub, locks } = deps;
  const app = new Hono();

  app.get("/", async (c) => c.json(await listSets(root)));

  function deletionFailure(c: Context, error: unknown): Response {
    if (error instanceof PathError) return invalidPath(c);
    if (error instanceof DeletionError) return c.json({ error: error.message }, error.status);
    if (error instanceof SetMutationError)
      return c.json(
        { error: "Finish or cancel this set's active tasks and tutor replies before deleting or restoring." },
        409,
      );
    if (error instanceof RevertConflictError)
      return c.json(
        {
          error:
            "Later edits conflict with this restore. Keep your new work and resolve the conflict before restoring.",
        },
        409,
      );
    throw error;
  }

  app.get("/recently-deleted", async (c) => c.json(await recentlyDeleted(root)));

  app.get("/:set/deletion", async (c) => {
    try {
      const path = c.req.query("path");
      return c.json(
        await previewDeletion(root, locks, { set: c.req.param("set"), ...(path === undefined ? {} : { path }) }),
      );
    } catch (error) {
      return deletionFailure(c, error);
    }
  });

  app.delete("/:set/notes", async (c) => {
    const body = await readJsonBody(c);
    if (
      typeof body.path !== "string" ||
      typeof body.token !== "string" ||
      (body.removeFromPlan !== undefined && typeof body.removeFromPlan !== "boolean") ||
      (body.linkedDataConfirmed !== undefined && typeof body.linkedDataConfirmed !== "boolean")
    )
      return invalidPath(c);
    const set = c.req.param("set");
    try {
      const result = await deleteFromTree(
        root,
        locks,
        { set, path: body.path },
        {
          token: body.token,
          removeFromPlan: body.removeFromPlan === true,
          linkedDataConfirmed: body.linkedDataConfirmed === true,
          assertIdle: () => deps.assertIdle?.(set),
        },
      );
      hub.publish({ type: "commit", sha: result.sha, subject: result.subject, author: "user" });
      return c.json(result);
    } catch (error) {
      return deletionFailure(c, error);
    }
  });

  app.delete("/:set", async (c) => {
    const body = await readJsonBody(c);
    if (typeof body.token !== "string" || typeof body.confirmation !== "string") return invalidPath(c);
    const set = c.req.param("set");
    try {
      const result = await deleteFromTree(
        root,
        locks,
        { set },
        {
          token: body.token,
          confirmation: body.confirmation,
          assertIdle: () => deps.assertIdle?.(set),
        },
      );
      hub.publish({ type: "commit", sha: result.sha, subject: result.subject, author: "user" });
      return c.json(result);
    } catch (error) {
      return deletionFailure(c, error);
    }
  });

  app.post("/:set/restore", async (c) => {
    const body = await readJsonBody(c);
    if (typeof body.sha !== "string" || !/^[a-f0-9]{40}$/.test(body.sha)) return invalidPath(c);
    const set = c.req.param("set");
    try {
      const result = await restoreDeletion(root, locks, set, body.sha, () => deps.assertIdle?.(set));
      hub.publish({ type: "commit", sha: result.sha, subject: result.subject, author: "user" });
      return c.json(result);
    } catch (error) {
      return deletionFailure(c, error);
    }
  });

  app.post("/", async (c) => {
    const body = await readJsonBody(c);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title.length < 1 || title.length > 120) {
      return c.json({ error: "title must be between 1 and 120 characters" }, 400);
    }
    if (body.goal !== undefined && typeof body.goal !== "string") {
      return c.json({ error: "goal must be a string" }, 400);
    }
    const goal = typeof body.goal === "string" ? body.goal : undefined;
    if (goal !== undefined && goal.length > 2000) {
      return c.json({ error: "goal must be at most 2000 characters" }, 400);
    }

    const result = await createSet(root, goal === undefined ? { title } : { title, goal });
    locks.setDeleted(result.slug, false);
    if (result.sha !== null) {
      hub.publish({ type: "commit", sha: result.sha, subject: result.subject, author: "user" });
    }
    return c.json({ slug: result.slug }, 201);
  });

  app.get("/:set/curriculum", async (c) => {
    const set = c.req.param("set");
    if (!(await setExists(root, set))) return notFound(c);
    try {
      return c.json(curriculumView(await readText(root, `${set}/curriculum.md`)));
    } catch (error) {
      if (error instanceof EditError && error.code === "not_found") return c.json(curriculumView(""));
      if (error instanceof PathError || (error instanceof EditError && error.code === "forbidden"))
        return invalidPath(c);
      throw error;
    }
  });

  app.patch("/:set/curriculum", async (c) => {
    const set = c.req.param("set");
    if (!(await setExists(root, set))) return notFound(c);
    const parsed = CurriculumEditRequest.safeParse(await readJsonBody(c));
    if (!parsed.success) return c.json({ error: "Invalid chapter edit", detail: parsed.error.message }, 400);
    try {
      deps.assertIdle?.(set);
      const result = await editCurriculum(root, locks, set, parsed.data);
      if (result.sha) hub.publish({ type: "commit", sha: result.sha, subject: result.subject, author: "user" });
      return c.json({ sha: result.sha });
    } catch (error) {
      if (error instanceof SetMutationError)
        return c.json({ error: "Finish or cancel this set’s active tasks before editing chapters." }, 409);
      if (error instanceof EditError && error.code === "conflict")
        return c.json({ error: "changed", current: error.current }, 409);
      if (error instanceof EditError && error.code === "not_found") return notFound(c);
      return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }
  });

  app.get("/:set/course", async (c) => {
    const set = c.req.param("set");
    if (!(await setExists(root, set))) return notFound(c);
    try {
      return c.json(await buildCourse(root, set, deps.jobs?.chapterJobs(set)));
    } catch (error) {
      if (error instanceof PathError) return invalidPath(c);
      if (error instanceof EditError && error.code === "not_found") return notFound(c);
      throw error;
    }
  });

  app.get("/:set/visuals", async (c) => {
    const set = c.req.param("set");
    if (!(await setExists(root, set))) return notFound(c);
    try {
      const dir = resolveInRoot(root, `${set}/visuals`);
      let entries: import("node:fs").Dirent[];
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return c.json({ files: [] });
        throw error;
      }
      const files = entries
        .filter((entry) => entry.isFile() && /\.(json|html)$/.test(entry.name))
        .map((entry) => entry.name)
        .sort();
      return c.json({ files });
    } catch (error) {
      if (error instanceof PathError) return invalidPath(c);
      throw error;
    }
  });

  app.get("/:set/sources", async (c) => {
    const set = c.req.param("set");
    if (!(await setExists(root, set))) return notFound(c);
    try {
      return c.json(await listSetSources(root, set));
    } catch (error) {
      if (error instanceof PathError || (error instanceof EditError && error.code === "forbidden"))
        return invalidPath(c);
      if (error instanceof EditError && error.code === "not_found") return notFound(c);
      throw error;
    }
  });

  app.get("/:set/notes", async (c) => {
    const set = c.req.param("set");
    if (!(await setExists(root, set))) return notFound(c);
    return c.json(await listNotes(root, set));
  });

  app.post("/:set/notes", async (c) => {
    const set = c.req.param("set");
    if (!(await setExists(root, set))) return notFound(c);

    const body = await readJsonBody(c);
    const title = typeof body.title === "string" ? body.title.trim() : "";
    if (title.length < 1 || title.length > 120) {
      return c.json({ error: "title must be between 1 and 120 characters" }, 400);
    }

    try {
      const result = await createNote(root, locks, set, title);
      if (result.sha !== null) {
        hub.publish({ type: "commit", sha: result.sha, subject: result.subject, author: "user" });
      }
      return c.json({ path: result.path }, 201);
    } catch (error) {
      if (error instanceof PathError || (error instanceof EditError && error.code === "forbidden")) {
        return invalidPath(c);
      }
      throw error;
    }
  });

  app.get("/:set/asset", async (c) => {
    const set = c.req.param("set");
    const rel = c.req.query("path") ?? "";
    if (!(await setExists(root, set))) return notFound(c);
    try {
      const valid = (value: string) => /^(assets|artifacts|visuals)\/.+\.(png|jpe?g|gif|webp|svg)$/i.test(value);
      if (
        !valid(rel) ||
        !valid(canonicalRel(root, `${set}/${rel}`).slice(set.length + 1)) ||
        !canonicalRel(root, `${set}/${rel}`).startsWith(`${set}/`)
      )
        return invalidPath(c);
      const abs = resolveInRoot(root, `${set}/${rel}`);
      if ((await fs.stat(abs)).size > 10 * 1024 * 1024) return c.json({ error: "asset too large" }, 413);
      const bytes = await fs.readFile(abs);
      const mime = IMAGE_MIME[rel.split(".").pop()?.toLowerCase() ?? ""];
      return c.body(bytes, 200, { ...MEDIA_HEADERS, "Content-Type": mime ?? "application/octet-stream" });
    } catch (error) {
      if (error instanceof PathError) return invalidPath(c);
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return notFound(c);
      throw error;
    }
  });

  app.get("/:set/file", async (c) => {
    const set = c.req.param("set");
    const rel = c.req.query("path");
    if (rel === undefined || rel === "") return c.json({ error: "path is required" }, 400);
    if (!(await setExists(root, set))) return notFound(c);

    try {
      const abs = resolveInRoot(root, `${set}/${rel}`);
      try {
        if ((await fs.stat(abs)).size > MAX_NOTE_BYTES) return c.json({ error: "file too large" }, 413);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return notFound(c);
        throw error;
      }
      if (/^visuals\//.test(rel) && !canonicalRel(root, `${set}/${rel}`).startsWith(`${set}/visuals/`))
        return invalidPath(c);
      if (/^(?:artifacts\/.+\.html|visuals\/.+\.(?:html|json))$/.test(rel))
        return c.json({ path: rel, raw: await fs.readFile(abs, "utf8") });
      const view = await readSetFile(root, set, rel);
      if (view === null) return notFound(c);
      return c.json(view);
    } catch (error) {
      if (error instanceof PathError) return invalidPath(c);
      throw error;
    }
  });

  app.put("/:set/file", async (c) => {
    const set = c.req.param("set");
    if (!(await setExists(root, set))) return notFound(c);

    const body = await readJsonBody(c);
    if (typeof body.path !== "string" || (!NOTE_PATH.test(body.path) && body.path !== "PLAN.md")) return invalidPath(c);
    if (typeof body.content !== "string" || typeof body.previous !== "string") {
      return c.json({ error: "content and previous must be strings" }, 400);
    }
    if (Buffer.byteLength(body.content, "utf8") > MAX_NOTE_BYTES) {
      return c.json({ error: "content must be at most 1 MB" }, 413);
    }

    try {
      const result = await (body.path === "PLAN.md" ? writePlanAsUser : writeNoteAsUser)(
        root,
        locks,
        `${set}/${body.path}`,
        body.content,
        body.previous,
      );
      if (result.sha !== null) {
        hub.publish({ type: "commit", sha: result.sha, subject: result.subject, author: "user" });
      }
      return c.json({ sha: result.sha });
    } catch (error) {
      if (error instanceof EditError) {
        if (error.code === "not_found") return notFound(c);
        if (error.code === "conflict") return c.json({ error: "changed", current: error.current ?? "" }, 409);
        if (error.code === "forbidden") return invalidPath(c);
      }
      if (error instanceof PathError) return invalidPath(c);
      if (body.path === "PLAN.md")
        return c.json({ error: error instanceof Error ? error.message : String(error) }, 400);
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
      // A commit may also touch other sets or library/; reverting it whole would change them too.
      const changed = await changedPaths(root, sha);
      const inside = changed.filter((rel) => rel.startsWith(`${set}/`));
      const outside = changed.filter((rel) => !rel.startsWith(`${set}/`));
      let newSha: string | null;
      if (outside.length === 0) {
        newSha = await revert(root, sha, "user");
      } else if (body.scope !== "set") {
        return c.json({ error: "commit touches paths outside this set", paths: outside }, 409);
      } else {
        if (inside.length === 0) return c.json({ error: "commit does not touch this set" }, 400);
        newSha = await revertPaths(root, sha, inside, `user: revert ${sha.slice(0, 7)} (set ${set} only)`, "user");
        if (newSha === null) return c.json({ error: "nothing to revert" }, 409);
      }
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
