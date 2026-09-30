import { promises as fs } from "node:fs";
import type { ParsedFileView, SiteImportResponse, SiteMapResponse } from "@studium/shared";
import type { Context } from "hono";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { EventHub } from "../events.js";
import { FirecrawlError, firecrawlMap } from "../ingest/firecrawl.js";
import { type DedupeKey, dedupeKeyFromUrl, keysMatch, sha256Hex } from "../ingest/ids.js";
import {
  findDuplicate,
  type IngestJobInput,
  isSourcePending,
  listSources,
  readParsedFile,
  readSource,
} from "../ingest/library.js";
import { assertPublicUrl, SafeFetchError } from "../ingest/safe-fetch.js";
import type { JobRunner } from "../jobs/runner.js";
import { resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";

/** Hard cap on a single multipart upload (decision: ≤ 100 MB). */
export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;
/** Multipart framing (boundaries, headers) allowed on top of the file cap. */
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;

export interface LibraryRoutesDeps {
  root: string;
  jobs: JobRunner;
  hub: EventHub;
  /** Overridable for tests; defaults to {@link MAX_UPLOAD_BYTES}. */
  maxUploadBytes?: number;
  /** Overridable for tests; defaults to the upload cap plus multipart overhead. */
  maxBodyBytes?: number;
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
  const maxBodyBytes = deps.maxBodyBytes ?? maxUploadBytes + MULTIPART_OVERHEAD_BYTES;
  const app = new Hono();

  app.get("/", async (c) => c.json(await listSources(root)));

  app.get("/:id", async (c) => {
    const view = await readSource(root, c.req.param("id"));
    if (view === null) return c.json({ error: "not found" }, 404);
    return c.json(view);
  });

  app.get("/:id/parsed", async (c) => {
    const file = c.req.query("file");
    if (file === undefined || file === "") return c.json({ error: "file is required" }, 400);
    const markdown = await readParsedFile(root, c.req.param("id"), file);
    if (markdown === null) return c.json({ error: "not found" }, 404);
    const view: ParsedFileView = { file, markdown };
    return c.json(view);
  });

  // Cap the whole request body while it streams, before any parser buffers it.
  app.post(
    "/",
    bodyLimit({ maxSize: maxBodyBytes, onError: (c) => c.json({ error: "file too large" }, 413) }),
    async (c) => {
      const contentType = c.req.header("content-type") ?? "";
      if (contentType.includes("multipart/form-data")) return addFile(c, deps, maxUploadBytes);
      return addUrl(c, deps);
    },
  );

  app.post(
    "/site-map",
    bodyLimit({ maxSize: 64 * 1024, onError: (c) => c.json({ error: "request too large" }, 413) }),
    (c) => mapSite(c),
  );
  app.post(
    "/site-import",
    bodyLimit({ maxSize: 1024 * 1024, onError: (c) => c.json({ error: "request too large" }, 413) }),
    (c) => importSite(c, deps),
  );

  return app;
}

async function mapSite(c: Context): Promise<Response> {
  const baseUrl = process.env.FIRECRAWL_API_URL?.trim();
  if (!baseUrl) return c.json({ error: "Site mapping requires Firecrawl. Configure FIRECRAWL_API_URL." }, 400);
  const body = await readJson(c);
  if (body === null || typeof body.url !== "string" || body.url.trim() === "") {
    return c.json({ error: "url is required" }, 400);
  }
  if (body.search !== undefined && typeof body.search !== "string") {
    return c.json({ error: "search must be a string" }, 400);
  }
  const limit = body.limit === undefined ? 100 : body.limit;
  if (typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 500) {
    return c.json({ error: "limit must be an integer from 1 to 500" }, 400);
  }
  try {
    const pages = await firecrawlMap(body.url.trim(), {
      baseUrl,
      apiKey: process.env.FIRECRAWL_API_KEY,
      ...(typeof body.search === "string" ? { search: body.search } : {}),
      limit,
      signal: c.req.raw.signal,
    });
    return c.json({ pages } satisfies SiteMapResponse);
  } catch (error) {
    if (error instanceof SafeFetchError) return c.json({ error: error.message }, 400);
    if (error instanceof FirecrawlError) return c.json({ error: error.message }, 502);
    throw error;
  }
}

async function importSite(c: Context, deps: LibraryRoutesDeps): Promise<Response> {
  const body = await readJson(c);
  if (
    body === null ||
    !Array.isArray(body.urls) ||
    body.urls.length < 1 ||
    body.urls.length > 100 ||
    body.urls.some((url) => typeof url !== "string" || url.trim() === "")
  ) {
    return c.json({ error: "urls must contain 1 to 100 non-empty URL strings" }, 400);
  }
  const set = await resolveSet(deps.root, body.set);
  if (set === false) return c.json({ error: "unknown set" }, 400);

  const urls: string[] = [];
  const keys: DedupeKey[] = [];
  const skipped: SiteImportResponse["skipped"] = [];
  for (const rawUrl of body.urls as string[]) {
    const url = rawUrl.trim();
    try {
      // Recheck selected pages even if they already passed the map filter.
      await assertPublicUrl(url);
    } catch (error) {
      if (!(error instanceof SafeFetchError)) throw error;
      skipped.push({ url, reason: error.message });
      continue;
    }
    const key = dedupeKeyFromUrl(url);
    if (keys.some((accepted) => keysMatch(accepted, key))) {
      skipped.push({ url, reason: "duplicate URL in this import" });
      continue;
    }
    const existing = await findDuplicate(deps.root, key);
    if (existing !== null) {
      skipped.push({ url, reason: `already in library: ${existing}` });
      continue;
    }
    keys.push(key);
    urls.push(url);
  }

  queueSiteImport(deps, urls, set);
  return c.json({ queued: urls.length, skipped } satisfies SiteImportResponse, 202);
}

/**
 * Keep at most three outstanding ingest jobs for this import. The remaining URLs
 * stay in this in-memory queue; a workspace job event releases each slot. A running
 * cancellation releases its slot only after the handler exits (finishedAt is set).
 */
function queueSiteImport(deps: LibraryRoutesDeps, urls: string[], set: string | null): void {
  if (urls.length === 0) return;
  const active = new Set<string>();
  let next = 0;
  const stop = deps.hub.subscribe((event) => {
    if (event.type !== "job" || event.job.finishedAt === null || !active.delete(event.job.id)) return;
    pump();
  });
  function pump(): void {
    while (active.size < 3 && next < urls.length) {
      const url = urls[next++];
      if (url === undefined) break;
      const input: IngestJobInput = { url, set };
      const job = deps.jobs.enqueue("ingest", input, { set, title: jobTitle(url) });
      active.add(job.id);
    }
    if (next === urls.length && active.size === 0) stop();
  }
  pump();
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
  // A source whose summary is still pending goes through the job, which resumes the Librarian.
  if (existing !== null && !(await isSourcePending(deps.root, existing))) {
    return c.json({ sourceId: existing, deduped: true }, 200);
  }

  const input: IngestJobInput = { url, set };
  const job = deps.jobs.enqueue("ingest", input, { set, title: jobTitle(url) });
  return c.json({ jobId: job.id }, 202);
}

async function addFile(c: Context, deps: LibraryRoutesDeps, maxUploadBytes: number): Promise<Response> {
  let form: Record<string, string | File | (string | File)[]>;
  try {
    form = await c.req.parseBody({ all: true });
  } catch {
    return c.json({ error: "invalid multipart body" }, 400);
  }

  const files: File[] = [];
  for (const value of Object.values(form)) {
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item !== "string") files.push(item);
    } else if (typeof value !== "string") {
      files.push(value);
    }
  }
  if (files.length === 0) return c.json({ error: "file is required" }, 400);
  if (files.length > 1) return c.json({ error: "only one file is allowed" }, 400);
  const file = files[0];
  if (file === undefined) return c.json({ error: "file is required" }, 400);
  if (file.size > maxUploadBytes) return c.json({ error: "file too large" }, 413);

  const set = await resolveSet(deps.root, form.set);
  if (set === false) return c.json({ error: "unknown set" }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const existing = await findDuplicate(deps.root, { sha256: sha256Hex(bytes) });
  if (existing !== null && !(await isSourcePending(deps.root, existing))) {
    return c.json({ sourceId: existing, deduped: true }, 200);
  }

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
