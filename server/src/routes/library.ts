import { promises as fs } from "node:fs";
import type { Context } from "hono";
import { Hono } from "hono";
import { dedupeKeyFromUrl, sha256Hex } from "../ingest/ids.js";
import { findDuplicate, type IngestJobInput, listSources, readSource } from "../ingest/library.js";
import type { JobRunner } from "../jobs/runner.js";
import { resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";

/** Hard cap on a single multipart upload (decision: ≤ 100 MB). */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

export interface LibraryRoutesDeps {
  root: string;
  jobs: JobRunner;
  /** Overridable for tests; defaults to {@link MAX_UPLOAD_BYTES}. */
  maxUploadBytes?: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function readJson(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}

async function resolveSet(root: string, value: unknown): Promise<string | null | false> {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !isSetSlug(value)) return false;
  try {
    const stats = await fs.stat(resolveInRoot(root, value));
    return stats.isDirectory() ? value : false;
  } catch {
    return false;
  }
}

function jobTitle(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname
      .split("/")
      .filter((part) => part !== "")
      .pop();
    return last === undefined ? parsed.hostname : decodeURIComponent(last);
  } catch {
    return url;
  }
}

export function libraryRoutes(deps: LibraryRoutesDeps): Hono {
  const { root } = deps;
  const maxUploadBytes = deps.maxUploadBytes ?? MAX_UPLOAD_BYTES;
  const app = new Hono();

  app.get("/", async (c) => c.json(await listSources(root)));

  app.get("/:id", async (c) => {
    const view = await readSource(root, c.req.param("id"));
    if (view === null) return c.json({ error: "not found" }, 404);
    return c.json(view);
  });

  app.post("/", async (c) => {
    const contentType = c.req.header("content-type") ?? "";
    if (contentType.includes("multipart/form-data")) return addFile(c, deps, maxUploadBytes);
    return addUrl(c, deps);
  });

  return app;
}

async function addUrl(c: Context, deps: LibraryRoutesDeps): Promise<Response> {
  const body = await readJson(c);
  if (body === null || typeof body.url !== "string" || body.url.trim() === "") {
    return c.json({ error: "url is required" }, 400);
  }
  const url = body.url.trim();
  try {
    new URL(url);
  } catch {
    return c.json({ error: "invalid url" }, 400);
  }

  const set = await resolveSet(deps.root, body.set);
  if (set === false) return c.json({ error: "unknown set" }, 400);

  const existing = await findDuplicate(deps.root, dedupeKeyFromUrl(url));
  if (existing !== null) return c.json({ sourceId: existing, deduped: true }, 200);

  const input: IngestJobInput = { url, set };
  const job = deps.jobs.enqueue("ingest", input, { set, title: jobTitle(url) });
  return c.json({ jobId: job.id }, 202);
}

async function addFile(c: Context, deps: LibraryRoutesDeps, maxUploadBytes: number): Promise<Response> {
  const declared = Number(c.req.header("content-length") ?? Number.NaN);
  if (Number.isFinite(declared) && declared > maxUploadBytes) {
    return c.json({ error: "file too large" }, 413);
  }

  let form: Record<string, string | File | (string | File)[]>;
  try {
    form = await c.req.parseBody();
  } catch {
    return c.json({ error: "invalid multipart body" }, 400);
  }

  const raw = form.file;
  const file = Array.isArray(raw) ? raw[0] : raw;
  if (file === undefined || typeof file === "string") return c.json({ error: "file is required" }, 400);
  if (file.size > maxUploadBytes) return c.json({ error: "file too large" }, 413);

  const set = await resolveSet(deps.root, form.set);
  if (set === false) return c.json({ error: "unknown set" }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const existing = await findDuplicate(deps.root, { sha256: sha256Hex(bytes) });
  if (existing !== null) return c.json({ sourceId: existing, deduped: true }, 200);

  const filename = file.name === "" ? "upload" : file.name;
  const input: IngestJobInput = {
    filename,
    bytes,
    ...(file.type === "" ? {} : { mime: file.type }),
    set,
  };
  const job = deps.jobs.enqueue("ingest", input, { set, title: filename });
  return c.json({ jobId: job.id }, 202);
}
