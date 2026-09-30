import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { type Highlight, type HighlightColor, parseFrontmatter } from "@studium/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import type { EventHub } from "../events.js";
import { createFile, EditError, replaceFile } from "../tree/edit.js";
import { commitPaths } from "../tree/git.js";
import type { FileLocks } from "../tree/lock.js";
import { PathError, resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";

/**
 * Learner highlights for one note live in `<set>/highlights/<note-file>.json`
 * as a plain JSON array (plan Decision 2). Every mutation is written through
 * `FileLocks` + atomic replace and committed as the `user` author.
 */

/** Set-relative note path, as accepted by `?note=` and the request bodies. */
const NOTE_PATH = /^notes\/[a-z0-9][a-z0-9._-]*\.md$/;
/** Root-relative highlight file; the set slug keeps it inside the study tree. */
const HIGHLIGHT_FILE = /^[a-z0-9][a-z0-9-]*\/highlights\/[a-z0-9][a-z0-9._-]*\.json$/;
const HIGHLIGHT_ID = /^h-[0-9a-f]{8}$/;
const COLORS: readonly HighlightColor[] = ["yellow", "green", "blue", "pink"];

const MAX_QUOTE_CHARS = 2000;
const MAX_CONTEXT_CHARS = 64;
const MAX_NOTE_CHARS = 1000;
const MAX_HIGHLIGHTS_PER_NOTE = 500;
/** A concurrent write makes the read-modify-write file stale; retry a few times. */
const WRITE_ATTEMPTS = 3;

export interface HighlightsRoutesDeps {
  root: string;
  locks: FileLocks;
  hub: EventHub;
}

type HighlightErrorCode = "not_found" | "conflict" | "malformed";

class HighlightError extends Error {
  readonly code: HighlightErrorCode;

  constructor(code: HighlightErrorCode, message: string) {
    super(message);
    this.name = "HighlightError";
    this.code = code;
  }
}

function isErrnoError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function isColor(value: unknown): value is HighlightColor {
  return typeof value === "string" && (COLORS as readonly string[]).includes(value);
}

function notFound(c: Context): Response {
  return c.json({ error: "not found" }, 404);
}

function invalidNote(c: Context): Response {
  return c.json({ error: "invalid note" }, 400);
}

function invalidRequest(c: Context, message: string): Response {
  return c.json({ error: message }, 400);
}

function highlightError(c: Context, error: HighlightError): Response {
  if (error.code === "not_found") return c.json({ error: error.message }, 404);
  if (error.code === "conflict") return c.json({ error: error.message }, 409);
  return c.json({ error: error.message }, 500);
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

async function setExists(root: string, set: string | undefined): Promise<boolean> {
  if (set === undefined || !isSetSlug(set)) return false;
  try {
    return (await fs.stat(resolveInRoot(root, set))).isDirectory();
  } catch {
    return false;
  }
}

/** Note text when the note exists as a file, else null. Throws `PathError` on escape. */
async function readNoteText(root: string, set: string, note: string): Promise<string | null> {
  const abs = resolveInRoot(root, `${set}/${note}`);
  try {
    const stats = await fs.stat(abs);
    if (!stats.isFile()) return null;
    return await fs.readFile(abs, "utf8");
  } catch (error) {
    if (isErrnoError(error, "ENOENT")) return null;
    throw error;
  }
}

function noteTitle(text: string, note: string): string {
  try {
    const title = parseFrontmatter(text).frontmatter.title;
    if (typeof title === "string" && title.trim() !== "") return title.trim();
  } catch {
    // Hand-edited frontmatter: fall back to the file name.
  }
  return note.slice("notes/".length);
}

/** `<set>/highlights/<note-file>.json`, e.g. `notes/03-svd.md` → `alpha/highlights/03-svd.md.json`. */
function highlightRel(set: string, note: string): string {
  const rel = `${set}/highlights/${note.slice("notes/".length)}.json`;
  if (!HIGHLIGHT_FILE.test(rel)) throw new PathError(`Invalid highlight path: ${rel}`);
  return rel;
}

function isHighlightFile(relFromRoot: string): boolean {
  return HIGHLIGHT_FILE.test(relFromRoot);
}

function newHighlightId(): string {
  return `h-${randomUUID().replaceAll("-", "").slice(0, 8)}`;
}

interface HighlightFile {
  highlights: Highlight[];
  /** Exact file text, or null when the note has no highlights file yet. */
  text: string | null;
}

async function readHighlightFile(root: string, rel: string): Promise<HighlightFile> {
  let text: string;
  try {
    text = await fs.readFile(resolveInRoot(root, rel), "utf8");
  } catch (error) {
    if (isErrnoError(error, "ENOENT")) return { highlights: [], text: null };
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new HighlightError("malformed", `${rel} is not valid JSON`);
  }
  if (!Array.isArray(parsed)) throw new HighlightError("malformed", `${rel} must hold an array`);
  return { highlights: parsed as Highlight[], text };
}

/**
 * Read-modify-write one note's highlights file. `apply` receives the current
 * list and returns the replacement plus the value to hand back to the route; a
 * lost race (another writer replaced the file first) re-reads and retries.
 */
async function updateHighlights<T>(
  root: string,
  locks: FileLocks,
  rel: string,
  apply: (highlights: Highlight[]) => { next: Highlight[]; value: T },
): Promise<T> {
  for (let attempt = 0; attempt < WRITE_ATTEMPTS; attempt += 1) {
    const current = await readHighlightFile(root, rel);
    const { next, value } = apply(current.highlights);
    const content = `${JSON.stringify(next, null, 2)}\n`;
    try {
      if (current.text === null) {
        await createFile(root, locks, "user", rel, content, { canWrite: isHighlightFile });
      } else {
        await replaceFile(root, locks, "user", rel, content, current.text, { canWrite: isHighlightFile });
      }
      return value;
    } catch (error) {
      if (error instanceof EditError && (error.code === "conflict" || error.code === "exists")) continue;
      throw error;
    }
  }
  throw new HighlightError("conflict", "highlights file kept changing; try again");
}

async function commitHighlights(root: string, hub: EventHub, rel: string, subject: string): Promise<void> {
  const sha = await commitPaths(root, [rel], subject, "user");
  if (sha !== null) hub.publish({ type: "commit", sha, subject, author: "user" });
}

export function highlightsRoutes(deps: HighlightsRoutesDeps): Hono {
  const { root, locks, hub } = deps;
  const app = new Hono();

  app.get("/", async (c) => {
    const set = c.req.param("set");
    const note = c.req.query("note");
    if (set === undefined) return notFound(c);
    if (note === undefined || !NOTE_PATH.test(note)) return invalidNote(c);
    if (!(await setExists(root, set))) return notFound(c);
    try {
      if ((await readNoteText(root, set, note)) === null) return notFound(c);
    } catch (error) {
      if (error instanceof PathError) return invalidNote(c);
      throw error;
    }
    const { highlights } = await readHighlightFile(root, highlightRel(set, note));
    return c.json({ highlights });
  });

  app.post("/", async (c) => {
    const set = c.req.param("set");
    if (set === undefined) return notFound(c);
    const body = await jsonBody(c);
    const note = typeof body.note === "string" ? body.note : "";
    if (!NOTE_PATH.test(note)) return invalidNote(c);
    if (!(await setExists(root, set))) return notFound(c);

    let noteText: string | null;
    try {
      noteText = await readNoteText(root, set, note);
    } catch (error) {
      if (error instanceof PathError) return invalidNote(c);
      throw error;
    }
    if (noteText === null) return notFound(c);

    const quote = typeof body.quote === "string" ? body.quote : null;
    if (quote === null || quote.trim() === "" || quote.length > MAX_QUOTE_CHARS) {
      return invalidRequest(c, `quote must be 1 to ${MAX_QUOTE_CHARS} characters`);
    }
    const prefix = body.prefix === undefined ? "" : body.prefix;
    const suffix = body.suffix === undefined ? "" : body.suffix;
    if (typeof prefix !== "string" || prefix.length > MAX_CONTEXT_CHARS) {
      return invalidRequest(c, `prefix must be at most ${MAX_CONTEXT_CHARS} characters`);
    }
    if (typeof suffix !== "string" || suffix.length > MAX_CONTEXT_CHARS) {
      return invalidRequest(c, `suffix must be at most ${MAX_CONTEXT_CHARS} characters`);
    }
    if (!isColor(body.color)) return invalidRequest(c, "color must be yellow, green, blue or pink");
    const comment = body.comment;
    if (comment !== undefined && (typeof comment !== "string" || comment.length > MAX_NOTE_CHARS)) {
      return invalidRequest(c, `comment must be at most ${MAX_NOTE_CHARS} characters`);
    }

    const rel = highlightRel(set, note);
    let highlight: Highlight;
    try {
      highlight = await updateHighlights(root, locks, rel, (current) => {
        if (current.length >= MAX_HIGHLIGHTS_PER_NOTE) {
          throw new HighlightError("conflict", `a note may hold at most ${MAX_HIGHLIGHTS_PER_NOTE} highlights`);
        }
        const created: Highlight = {
          id: newHighlightId(),
          quote,
          prefix,
          suffix,
          color: body.color as HighlightColor,
          ...(comment === undefined || comment === "" ? {} : { note: comment }),
          createdAt: new Date().toISOString(),
        };
        return { next: [...current, created], value: created };
      });
    } catch (error) {
      if (error instanceof HighlightError) return highlightError(c, error);
      throw error;
    }

    await commitHighlights(root, hub, rel, `user: highlight ${noteTitle(noteText, note)}`);
    return c.json({ highlight }, 201);
  });

  app.patch("/:id", async (c) => {
    const set = c.req.param("set");
    const id = c.req.param("id");
    if (set === undefined) return notFound(c);
    const body = await jsonBody(c);
    const note = typeof body.note === "string" ? body.note : "";
    if (!NOTE_PATH.test(note)) return invalidNote(c);
    if (!HIGHLIGHT_ID.test(id)) return invalidRequest(c, "invalid highlight id");
    if (!(await setExists(root, set))) return notFound(c);

    let noteText: string | null;
    try {
      noteText = await readNoteText(root, set, note);
    } catch (error) {
      if (error instanceof PathError) return invalidNote(c);
      throw error;
    }
    if (noteText === null) return notFound(c);

    const color = body.color;
    if (color !== undefined && !isColor(color)) {
      return invalidRequest(c, "color must be yellow, green, blue or pink");
    }
    const comment = body.comment;
    if (comment !== undefined && (typeof comment !== "string" || comment.length > MAX_NOTE_CHARS)) {
      return invalidRequest(c, `comment must be at most ${MAX_NOTE_CHARS} characters`);
    }
    if (color === undefined && comment === undefined) return invalidRequest(c, "nothing to update");

    const rel = highlightRel(set, note);
    let highlight: Highlight;
    try {
      highlight = await updateHighlights(root, locks, rel, (current) => {
        const index = current.findIndex((candidate) => candidate.id === id);
        const existing = index === -1 ? undefined : current[index];
        if (existing === undefined) throw new HighlightError("not_found", `no highlight ${id} on ${note}`);
        const updated: Highlight = color === undefined ? { ...existing } : { ...existing, color };
        if (comment !== undefined) {
          if (comment === "") delete updated.note;
          else updated.note = comment;
        }
        const next = [...current];
        next[index] = updated;
        return { next, value: updated };
      });
    } catch (error) {
      if (error instanceof HighlightError) return highlightError(c, error);
      throw error;
    }

    await commitHighlights(root, hub, rel, `user: highlight ${noteTitle(noteText, note)}`);
    return c.json({ highlight });
  });

  app.delete("/:id", async (c) => {
    const set = c.req.param("set");
    const id = c.req.param("id");
    const note = c.req.query("note");
    if (set === undefined) return notFound(c);
    if (note === undefined || !NOTE_PATH.test(note)) return invalidNote(c);
    if (!HIGHLIGHT_ID.test(id)) return invalidRequest(c, "invalid highlight id");
    if (!(await setExists(root, set))) return notFound(c);

    let noteText: string | null;
    try {
      noteText = await readNoteText(root, set, note);
    } catch (error) {
      if (error instanceof PathError) return invalidNote(c);
      throw error;
    }
    if (noteText === null) return notFound(c);

    const rel = highlightRel(set, note);
    try {
      await updateHighlights(root, locks, rel, (current) => {
        if (!current.some((candidate) => candidate.id === id)) {
          throw new HighlightError("not_found", `no highlight ${id} on ${note}`);
        }
        return { next: current.filter((candidate) => candidate.id !== id), value: undefined };
      });
    } catch (error) {
      if (error instanceof HighlightError) return highlightError(c, error);
      throw error;
    }

    await commitHighlights(root, hub, rel, `user: remove highlight ${noteTitle(noteText, note)}`);
    return c.body(null, 204);
  });

  return app;
}
