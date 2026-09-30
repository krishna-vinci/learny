import { promises as fs } from "node:fs";
import path from "node:path";
import type { ImageContent } from "@earendil-works/pi-ai";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { ConfigYaml, type JobResult, PlanFrontmatter, parseFrontmatter } from "@studium/shared";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { resolveRoleModel } from "../agent/models.js";
import { RoleModelError, runRole } from "../agent/run-role.js";
import type { EventHub } from "../events.js";
import { cleanMarkdown } from "../ingest/clean.js";
import { detectInput } from "../ingest/detect.js";
import { type DedupeKey, dedupeKeyFromUrl, sha256Hex } from "../ingest/ids.js";
import {
  dedupeLockKeys,
  findDuplicate,
  type IngestJobInput,
  isSourcePending,
  readSource,
  withDedupeLock,
  writeSource,
} from "../ingest/library.js";
import { SAFE_FETCH_MAX_BYTES, safeFetch } from "../ingest/safe-fetch.js";
import type { Extracted, InputKind } from "../ingest/types.js";
import { extract } from "../ingest/types.js";
import type { McpManager } from "../mcp/bridge.js";
import { editFile, readText } from "../tree/edit.js";
import { commitPaths } from "../tree/git.js";
import type { FileLocks } from "../tree/lock.js";
import { resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";
import type { JobContext, JobHandler } from "./runner.js";
import { usageFromPiMessages } from "./runner.js";

export interface IngestJobDeps {
  root: string;
  locks: FileLocks;
  mcp: McpManager;
  runtime: ModelRuntime;
  hub: EventHub;
}

const IMAGE_MIME_BY_EXT: Record<string, string> = {
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isErrnoError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

export function parseIngestJobInput(value: unknown): IngestJobInput {
  if (!isRecord(value)) throw new Error("invalid ingest input");
  const url = typeof value.url === "string" ? value.url.trim() : undefined;
  const filename =
    typeof value.filename === "string" && value.filename.trim() !== "" ? value.filename.trim() : undefined;
  const mime = typeof value.mime === "string" && value.mime.trim() !== "" ? value.mime.trim() : undefined;
  const bytes = value.bytes instanceof Uint8Array && value.bytes.length > 0 ? new Uint8Array(value.bytes) : undefined;
  const set = value.set === null || value.set === undefined ? null : value.set;
  const inboxPath = typeof value.inboxPath === "string" && value.inboxPath !== "" ? value.inboxPath : undefined;

  if (set !== null && (typeof set !== "string" || !isSetSlug(set))) throw new Error("invalid set");
  if ((url === undefined || url === "") && bytes === undefined) {
    throw new Error("a URL or file bytes are required");
  }
  if (bytes !== undefined && filename === undefined) throw new Error("a filename is required for file bytes");
  return {
    ...(url === undefined || url === "" ? {} : { url }),
    ...(filename === undefined ? {} : { filename }),
    ...(mime === undefined ? {} : { mime }),
    ...(bytes === undefined ? {} : { bytes }),
    set,
    ...(inboxPath === undefined ? {} : { inboxPath }),
  };
}

function inboxFile(root: string, rel: string | undefined): { rel: string; abs: string } | null {
  if (rel === undefined) return null;
  const inboxRoot = resolveInRoot(root, "library/_inbox");
  const abs = resolveInRoot(root, rel);
  const relative = path.relative(inboxRoot, abs);
  if (relative.startsWith("..") || path.isAbsolute(relative) || relative.includes(path.sep)) {
    throw new Error("inboxPath must name a file in library/_inbox");
  }
  return { rel, abs };
}

async function removeInbox(file: { abs: string }): Promise<void> {
  await fs.unlink(file.abs).catch((error: unknown) => {
    if (!isErrnoError(error, "ENOENT")) throw error;
  });
}

async function moveInboxToFailed(root: string, file: { abs: string }): Promise<void> {
  const failedDir = resolveInRoot(root, "library/_inbox/failed");
  await fs.mkdir(failedDir, { recursive: true });
  const name = path.basename(file.abs);
  const ext = path.extname(name);
  const stem = ext === "" ? name : name.slice(0, -ext.length);
  for (let suffix = 1; ; suffix++) {
    const target = path.join(failedDir, suffix === 1 ? name : `${stem}-${suffix}${ext}`);
    try {
      await fs.access(target);
      continue;
    } catch (error) {
      if (!isErrnoError(error, "ENOENT")) throw error;
    }
    await fs.rename(file.abs, target).catch((error: unknown) => {
      if (!isErrnoError(error, "ENOENT")) throw error;
    });
    return;
  }
}

function originalExt(input: IngestJobInput): string | null {
  const fromName = input.filename === undefined ? "" : path.extname(input.filename).replace(/^\./, "").toLowerCase();
  if (fromName !== "") return fromName;
  if (input.mime === undefined) return null;
  const subtype = input.mime.toLowerCase().split(";")[0]?.split("/")[1] ?? "";
  return subtype === "" ? null : subtype.replace("svg+xml", "svg").replace("jpeg", "jpg");
}

async function librarianAcceptsImages(deps: IngestJobDeps): Promise<boolean> {
  const config = ConfigYaml.parse(parseYaml(await readText(deps.root, "_global/config.yaml")));
  return resolveRoleModel(deps.runtime, config, "librarian").input.includes("image");
}

function imageTitle(input: IngestJobInput): string {
  if (input.filename !== undefined) return path.basename(input.filename, path.extname(input.filename));
  if (input.url !== undefined) {
    try {
      const parsed = new URL(input.url);
      const last = parsed.pathname
        .split("/")
        .filter((part) => part !== "")
        .pop();
      return last === undefined ? parsed.hostname : decodeURIComponent(last);
    } catch {
      // Detect has already classified this as a URL; use a stable fallback below.
    }
  }
  return "Untitled image";
}

function imageMime(input: IngestJobInput, bytes: Uint8Array): string {
  const declared = input.mime?.toLowerCase().split(";")[0];
  if (declared !== undefined && Object.values(IMAGE_MIME_BY_EXT).includes(declared)) return declared;
  const ext = originalExt(input);
  if (ext !== null && IMAGE_MIME_BY_EXT[ext] !== undefined) return IMAGE_MIME_BY_EXT[ext];
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return "image/png";
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return "image/jpeg";
  if (bytes[0] === 0x47 && bytes[1] === 0x49) return "image/gif";
  if (bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[8] === 0x57) return "image/webp";
  throw new Error("the image format is not supported for model transcription");
}

async function imageForLibrarian(
  input: IngestJobInput,
  signal: AbortSignal,
): Promise<{ bytes: Uint8Array; ext: string; image: ImageContent }> {
  let bytes = input.bytes;
  let mime = input.mime;
  if (bytes === undefined) {
    if (input.url === undefined) throw new Error("image input has no bytes");
    const response = await safeFetch(input.url, { signal, maxBytes: SAFE_FETCH_MAX_BYTES });
    bytes = response.bytes;
    mime = response.contentType ?? undefined;
  }
  const resolvedMime = imageMime({ ...input, ...(mime === undefined ? {} : { mime }) }, bytes);
  return {
    bytes,
    ext: originalExt({ ...input, mime: resolvedMime }) ?? "png",
    image: { type: "image", data: Buffer.from(bytes).toString("base64"), mimeType: resolvedMime },
  };
}

async function extractInput(
  deps: IngestJobDeps,
  input: IngestJobInput,
  kind: InputKind,
  signal: AbortSignal,
): Promise<{ extracted: Extracted; original?: { bytes: Uint8Array; ext: string }; images?: ImageContent[] }> {
  if (kind === "audio") throw new Error("Audio ingestion is unsupported by the configured Librarian model");
  if (kind !== "image") {
    const extracted = await extract(kind, input, {
      ...(process.env.MINERU_URL === undefined ? {} : { mineruUrl: process.env.MINERU_URL }),
      ...(process.env.FIRECRAWL_API_URL === undefined ? {} : { firecrawlUrl: process.env.FIRECRAWL_API_URL }),
      ...(process.env.FIRECRAWL_API_KEY === undefined ? {} : { firecrawlKey: process.env.FIRECRAWL_API_KEY }),
      signal,
    });
    const ext = originalExt(input);
    return {
      extracted,
      ...(input.bytes === undefined || ext === null ? {} : { original: { bytes: input.bytes, ext } }),
    };
  }

  if (!(await librarianAcceptsImages(deps))) throw new Error("The configured Librarian model cannot read images");
  const image = await imageForLibrarian(input, signal);
  const title = imageTitle(input);
  return {
    extracted: {
      title,
      authors: [],
      markdown: `# ${title}\n\nThe attached image is supplied directly to the Librarian for transcription.\n`,
      pages: null,
      parseTier: "basic",
      warning: null,
      url: input.url ?? null,
      originalExt: image.ext,
    },
    original: { bytes: image.bytes, ext: image.ext },
    images: [image.image],
  };
}

async function incomingDuplicate(root: string, input: IngestJobInput): Promise<string | null> {
  const urlKey = input.url === undefined ? {} : dedupeKeyFromUrl(input.url);
  const key = input.bytes === undefined ? urlKey : { ...urlKey, sha256: sha256Hex(input.bytes) };
  return findDuplicate(root, key);
}

function planWithSource(plan: string, sourceId: string): string | null {
  const { frontmatter, body } = parseFrontmatter(plan);
  const parsed = PlanFrontmatter.safeParse(frontmatter);
  if (!parsed.success) throw new Error("PLAN.md frontmatter is invalid");
  if ((parsed.data.sources ?? []).includes(sourceId)) return null;
  const next = { ...frontmatter, sources: [...(parsed.data.sources ?? []), sourceId] };
  return `---\n${stringifyYaml(next, { lineWidth: 0 })}---\n${body}`;
}

async function linkSourceToSet(deps: IngestJobDeps, set: string, sourceId: string): Promise<string | null> {
  const rel = `${set}/PLAN.md`;
  const before = await readText(deps.root, rel);
  const after = planWithSource(before, sourceId);
  if (after === null) return null;
  await editFile(deps.root, deps.locks, `user:link:${crypto.randomUUID()}`, rel, before, after, {
    canWrite: (candidate) => candidate === rel,
  });
  return commitPaths(deps.root, [rel], `user: link ${sourceId}`, "user");
}

function librarianTask(sourceId: string, parsedFiles: string[], hasImage: boolean): string {
  return [
    "Load the source-summary skill, then complete the existing library source entry.",
    `Edit exactly library/${sourceId}/source.md; never rewrite parsed files or the original.`,
    `Read ${parsedFiles.join(", ") || "(there are no parsed files)"}.`,
    "Replace the pending body with a concrete summary of at most 200 words, a TOC whose locations exist, and a credibility tier with a one-line reason.",
    "Replace `credibility: pending` with the chosen tier and reason while preserving every other frontmatter field.",
    ...(hasImage
      ? [
          "The user message includes the source image. Transcribe useful text and visual structure under a `## Transcription` heading before the summary.",
        ]
      : []),
  ].join("\n");
}

type InboxFile = { rel: string; abs: string };

/** Lock keys that identify this input's dedupe bucket (URL / arXiv / DOI / sha256). */
function ingestLockKeys(input: IngestJobInput): string[] {
  const key: DedupeKey = input.url === undefined ? {} : dedupeKeyFromUrl(input.url);
  if (input.bytes !== undefined) key.sha256 = sha256Hex(input.bytes);
  return dedupeLockKeys(key);
}

/**
 * Outcome of the summary step. A source is already durably committed by
 * `writeSource`, so a model failure here degrades to a warning and leaves the
 * source `credibility: pending` for the resume-on-duplicate path to finish.
 */
type SummaryOutcome = { commitSha: string | null; warning: string | null };

function summaryPending(reason: string): SummaryOutcome {
  return { commitSha: null, warning: `Summary pending: ${reason}` };
}

/**
 * Run the Librarian to replace the pending summary in `library/<id>/source.md`
 * and commit it. A model error, or a run that never edits the file, resolves to
 * a warning instead of throwing; real infrastructure errors still throw.
 */
async function runLibrarian(
  deps: IngestJobDeps,
  sourceId: string,
  ctx: JobContext,
  images?: ImageContent[],
): Promise<SummaryOutcome> {
  ctx.progress("Summarizing source");
  const sourceRel = `library/${sourceId}/source.md`;
  const writtenByLibrarian = new Set<string>();
  const view = await readSource(deps.root, sourceId);
  if (view === null) throw new Error(`library source disappeared: ${sourceId}`);
  let result: Awaited<ReturnType<typeof runRole>>;
  try {
    result = await runRole("librarian", {
      root: deps.root,
      set: null,
      task: librarianTask(sourceId, view.parsedFiles, images !== undefined),
      locks: deps.locks,
      mcp: deps.mcp,
      runtime: deps.runtime,
      hub: deps.hub,
      signal: ctx.signal,
      onModel: (provider) => ctx.useProvider?.(provider),
      onFallback: (_from, to) => ctx.progress(`Librarian model rate-limited; using ${to}`),
      ...(images === undefined ? {} : { images }),
      onWrite: (file) => writtenByLibrarian.add(file),
    });
  } catch (error) {
    ctx.signal.throwIfAborted();
    if (error instanceof RoleModelError) {
      return summaryPending(`Librarian model ${error.model} failed: ${error.message}`);
    }
    throw error;
  }
  ctx.addUsage(usageFromPiMessages(result.messages));
  if (!writtenByLibrarian.has(sourceRel)) return summaryPending("Librarian did not update source.md");
  ctx.signal.throwIfAborted();
  const commitSha = await commitPaths(deps.root, [sourceRel], `librarian: summarize ${sourceId}`, "librarian");
  if (commitSha === null) return summaryPending("Librarian did not update source.md");
  deps.hub.publish({
    type: "commit",
    sha: commitSha,
    subject: `librarian: summarize ${sourceId}`,
    author: "librarian",
  });
  return { commitSha, warning: null };
}

/** Title recorded in `library/<id>/source.md`, or null when it is missing or unreadable. */
async function storedSourceTitle(root: string, sourceId: string): Promise<string | null> {
  try {
    const { frontmatter } = parseFrontmatter(await readText(root, `library/${sourceId}/source.md`));
    return typeof frontmatter.title === "string" && frontmatter.title.trim() !== "" ? frontmatter.title.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Finish an ingest that matched an existing source: link it to the target set,
 * clear the inbox file, and resume the Librarian when the summary is still pending.
 */
async function handleExisting(
  deps: IngestJobDeps,
  ctx: JobContext,
  sourceId: string,
  set: string | null,
  inbox: InboxFile | null,
): Promise<JobResult> {
  if (await isSourcePending(deps.root, sourceId)) {
    // The duplicate is found before extraction, so the job title is still derived from the URL.
    const title = await storedSourceTitle(deps.root, sourceId);
    if (title !== null) ctx.setTitle?.(title);
    ctx.progress("Resuming summary");
    const summary = await runLibrarian(deps, sourceId, ctx);
    if (set !== null) {
      ctx.signal.throwIfAborted();
      await linkSourceToSet(deps, set, sourceId);
    }
    if (inbox !== null) {
      ctx.signal.throwIfAborted();
      await removeInbox(inbox);
    }
    ctx.progress("Source ready");
    return {
      sourceId,
      ...(summary.commitSha === null ? {} : { commitSha: summary.commitSha }),
      ...(summary.warning === null ? {} : { warning: summary.warning }),
    };
  }
  if (set !== null) {
    ctx.signal.throwIfAborted();
    await linkSourceToSet(deps, set, sourceId);
  }
  if (inbox !== null) {
    ctx.signal.throwIfAborted();
    await removeInbox(inbox);
  }
  ctx.progress("Found existing source");
  return { sourceId };
}

export function createIngestJob(deps: IngestJobDeps): JobHandler {
  return async (rawInput: unknown, ctx: JobContext) => {
    const input = parseIngestJobInput(rawInput);
    const set = input.set ?? null;
    const inbox = inboxFile(deps.root, input.inboxPath);
    ctx.signal.throwIfAborted();

    // Serialize lookup → extract → write (and the Librarian completion) for this
    // dedupe bucket, so two concurrent jobs cannot create duplicate sources.
    return withDedupeLock(ingestLockKeys(input), async () => {
      // Once the library source exists, later failures must not discard the drop.
      let sourceExists = false;
      try {
        ctx.progress("Detecting input");
        const kind = detectInput(input);

        ctx.progress("Checking for duplicates");
        const duplicate = await incomingDuplicate(deps.root, input);
        if (duplicate !== null) {
          sourceExists = true;
          return await handleExisting(deps, ctx, duplicate, set, inbox);
        }

        ctx.progress("Extracting source");
        const extraction = await extractInput(deps, input, kind, ctx.signal);
        ctx.signal.throwIfAborted();
        if (extraction.extracted.title !== null) ctx.setTitle?.(extraction.extracted.title);
        ctx.progress("Cleaning extracted text");
        const extracted = { ...extraction.extracted, markdown: cleanMarkdown(extraction.extracted.markdown) };

        ctx.progress("Writing library source");
        ctx.signal.throwIfAborted();
        const written = await writeSource(deps.root, extracted, extraction.original);
        const sourceId = written.id;
        sourceExists = true;
        if (written.deduped) return await handleExisting(deps, ctx, sourceId, set, inbox);
        if (set !== null) {
          ctx.progress("Linking source to set");
          ctx.signal.throwIfAborted();
          await linkSourceToSet(deps, set, sourceId);
        }

        const summary = await runLibrarian(deps, sourceId, ctx, extraction.images);

        if (inbox !== null) {
          ctx.signal.throwIfAborted();
          await removeInbox(inbox);
        }
        ctx.progress("Source ready");
        const commitSha = summary.commitSha ?? written.commitSha;
        return {
          sourceId,
          ...(commitSha === null ? {} : { commitSha }),
          ...(summary.warning === null ? {} : { warning: summary.warning }),
        };
      } catch (error) {
        // Only failures before the source exists discard the drop into failed/.
        if (inbox !== null && !sourceExists) await moveInboxToFailed(deps.root, inbox).catch(() => undefined);
        throw error;
      }
    });
  };
}
