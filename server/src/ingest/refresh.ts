import { constants, promises as fs } from "node:fs";
import path from "node:path";
import { parseFrontmatter, type SourceRefreshResult } from "@studium/shared";
import { stringify } from "yaml";
import { readText, writeTextLocked } from "../tree/edit.js";
import { commitPaths } from "../tree/git.js";
import type { FileLocks } from "../tree/lock.js";
import { canonicalRel, resolveInRoot } from "../tree/paths.js";
import { cleanMarkdown } from "./clean.js";
import { detectInput } from "./detect.js";
import { publicErrorReason } from "./error-reason.js";
import { captureFigures, readSourceFigures } from "./figures.js";
import { collectImages } from "./images.js";
import { readParsedFile, readSource, withDedupeLock } from "./library.js";
import { parsedFigureLinks } from "./mineru-markdown.js";
import { MIN_PARSE_QUALITY, scoreParseQuality } from "./quality.js";
import { INGEST_MAX_BYTES } from "./safe-fetch.js";
import { preserveSectionAnchors, sourceSections } from "./sections.js";
import { splitParsed } from "./split.js";
import { type ExtractOptions, extract } from "./types.js";

export interface RefreshOptions extends ExtractOptions {
  root: string;
  locks: FileLocks;
  blockedHosts?: Map<string, string>;
}
function confined(root: string, rel: string): string {
  if (canonicalRel(root, rel) !== rel) throw new Error("Source paths may not be symlink aliases");
  return resolveInRoot(root, rel);
}
export async function refreshSource(
  opts: RefreshOptions,
  id: string,
): Promise<{ refresh: SourceRefreshResult; commitSha?: string }> {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) throw new Error("Invalid source id");
  const { root, locks } = opts;
  const dir = `library/${id}`,
    sourceRel = `${dir}/source.md`;
  confined(root, dir);
  confined(root, sourceRel);
  const view = await readSource(root, id);
  if (!view) throw new Error("Source not found");
  const snapshot = await readText(root, sourceRel);
  const old = (
    await Promise.all(
      view.parsedFiles.map(async (f) => {
        confined(root, `${dir}/${f}`);
        return (await readParsedFile(root, id, f)) ?? "";
      }),
    )
  ).join("\n\n");
  const before = scoreParseQuality(old).score;
  const base: SourceRefreshResult = { sourceId: id, before, after: before, status: "skipped", disappearedAnchors: [] };
  const metadata = parseFrontmatter(snapshot);
  let host: string | undefined;
  try {
    opts.signal?.throwIfAborted();
    let input: { url?: string; bytes?: Uint8Array; filename?: string };
    // Uploaded originals carry sha256. Never fetch a URL to replace an upload.
    const hasPdfOriginal = await fs
      .access(confined(root, `${dir}/original.pdf`))
      .then(() => true)
      .catch((error: NodeJS.ErrnoException) => {
        if (error.code === "ENOENT") return false;
        throw error;
      });
    if (hasPdfOriginal || typeof metadata.frontmatter.sha256 === "string" || !view.source.url) {
      const names = (await fs.readdir(confined(root, dir))).filter((f) => /^original\.[a-z0-9]+$/.test(f));
      if (names.length !== 1)
        return {
          refresh: { ...base, reason: "Uploaded original is missing or ambiguous; upload it again before refreshing." },
        };
      const name = names[0];
      if (!name) throw new Error("Original missing");
      const handle = await fs.open(confined(root, `${dir}/${name}`), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.size > INGEST_MAX_BYTES) throw new Error("Original is not a supported-size file");
        input = {
          bytes: new Uint8Array(await handle.readFile()),
          filename: name,
          ...(name === "original.pdf" && view.source.url ? { url: view.source.url } : {}),
        };
      } finally {
        await handle.close();
      }
    } else {
      host = new URL(view.source.url).hostname;
      const blocked = opts.blockedHosts?.get(host);
      if (blocked) return { refresh: { ...base, reason: `Host skipped after earlier blocked fetch: ${blocked}` } };
      input = { url: view.source.url };
    }
    const extracted = await extract(
      input.bytes ? detectInput({ bytes: input.bytes, filename: input.filename }) : detectInput(input),
      input,
      { ...opts, license: typeof metadata.frontmatter.license === "string" ? metadata.frontmatter.license : undefined },
    );
    // Keep provenance even when refresh reads an original rather than its remote URL.
    extracted.url ??= view.source.url;
    opts.signal?.throwIfAborted();
    const cleaned = cleanMarkdown(extracted.markdown);
    const quality = scoreParseQuality(extracted.unreadable ? "" : cleaned);
    if (
      extracted.unreadable ||
      quality.score < MIN_PARSE_QUALITY ||
      quality.score < before ||
      !quality.signals.characters
    )
      return {
        refresh: {
          ...base,
          status: "unchanged",
          reason: `Retained existing parse; new extraction quality ${quality.score} is unusable or lower.`,
        },
      };
    const preserved = preserveSectionAnchors(old, cleaned);
    const split = splitParsed(preserved.markdown);
    const refresh: SourceRefreshResult = {
      ...base,
      after: quality.score,
      status: "refreshed",
      disappearedAnchors: preserved.disappeared,
    };
    const content = new Map<string, string | Uint8Array>();
    for (const part of split.parts) content.set(`${dir}/${part.path}`, parsedFigureLinks(part.content, part.path));
    content.set(
      `${dir}/sections.json`,
      JSON.stringify(
        sourceSections(preserved.markdown).map(({ anchor, summary }) => ({ anchor, summary })),
        null,
        2,
      ),
    );
    const previousFigures = await readSourceFigures(root, id);
    const captured = await captureFigures({
      images: [
        ...(extracted.images ??
          (extracted.embeddedFigures ? [] : collectImages(extracted.markdown, extracted.url ?? ""))),
        ...previousFigures
          .filter((figure) => !figure.url.includes("#figure-"))
          .map((figure) => ({ ...figure, nearHeading: figure.section })),
      ],
      title: view.source.title,
      authors: view.source.authors,
      pageUrl: view.source.url,
      markdown: preserved.markdown,
      signal: opts.signal,
    });
    for (const [file, bytes] of extracted.embeddedFigures?.files ?? []) captured.files.set(file, bytes);
    captured.figures.push(...(extracted.embeddedFigures?.figures ?? []));
    for (const [file, bytes] of captured.files) content.set(`${dir}/${file}`, bytes);
    // A failed remote download never discards an already captured local figure.
    for (const figure of captured.figures) {
      const previous = previousFigures.find((f) => f.url === figure.url);
      if (!figure.path && previous?.path) figure.path = previous.path;
    }
    content.set(`${dir}/images.json`, JSON.stringify(captured.figures, null, 2));
    const toc = split.toc ?? "| Section | Location |\n| --- | --- |\n| Parsed source | parsed.md |";
    const body = metadata.body.replace(/\n## (?:Contents|Table of contents|TOC)\b[\s\S]*?(?=\n## |$)/i, "").trimEnd();
    const next: Record<string, unknown> = {
      ...metadata.frontmatter,
      parse_tier: extracted.parseTier,
      quality,
      refreshed_at: new Date().toISOString(),
      last_refresh: refresh,
    };
    if (extracted.warning) next.parse_warning = extracted.warning;
    else delete next.parse_warning;
    if (extracted.transcriptStatus) next.transcript_status = extracted.transcriptStatus;
    else delete next.transcript_status;
    content.set(sourceRel, `---\n${stringify(next, { lineWidth: 0 })}---\n${body}\n\n## Contents\n\n${toc}\n`);
    const paths = [...new Set([...content.keys(), ...view.parsedFiles.map((f) => `${dir}/${f}`)])].sort();
    const holder = `librarian:refresh:${crypto.randomUUID()}`;
    return await withDedupeLock([`${root}:${dir}`], () =>
      locks.withLock(sourceRel, holder, async () => {
        if ((await readText(root, sourceRel)) !== snapshot)
          return { refresh: { ...base, reason: "Source changed during refresh; try again." } };
        const lockFiles = async (index: number): Promise<{ refresh: SourceRefreshResult; commitSha?: string }> => {
          const rel = paths[index];
          if (rel)
            return rel === sourceRel ? lockFiles(index + 1) : locks.withLock(rel, holder, () => lockFiles(index + 1));
          opts.signal?.throwIfAborted();
          const backups = new Map<string, Buffer | null>();
          for (const p of paths) {
            confined(root, p);
            backups.set(
              p,
              await fs.readFile(resolveInRoot(root, p)).catch((e: NodeJS.ErrnoException) => {
                if (e.code === "ENOENT") return null;
                throw e;
              }),
            );
          }
          const latest = view.parsedFiles.map((f) => backups.get(`${dir}/${f}`) ?? "").join("\n\n");
          if (latest !== old)
            return { refresh: { ...base, reason: "Parsed source changed during refresh; try again." } };
          const canWrite = (p: string) => paths.includes(p);
          const writeContent = async (p: string, value: string | Uint8Array) => {
            if (typeof value === "string") await writeTextLocked(root, locks, holder, p, value, canWrite);
            else {
              const temporary = `${p}.tmp-${crypto.randomUUID()}`;
              try {
                await fs.writeFile(confined(root, temporary), value, { flag: "wx" });
                await fs.rename(confined(root, temporary), confined(root, p));
              } finally {
                await fs.unlink(confined(root, temporary)).catch(() => {});
              }
            }
          };
          try {
            // Metadata lands last; every changed file is locked and atomically written.
            for (const [p, text] of content)
              if (p !== sourceRel) {
                await fs.mkdir(path.dirname(confined(root, p)), { recursive: true });
                await writeContent(p, text);
              }
            for (const p of paths) if (!content.has(p)) await fs.unlink(confined(root, p));
            await writeContent(sourceRel, content.get(sourceRel) ?? "");
            const sha = await commitPaths(root, paths, `librarian: refresh ${id}`, "librarian");
            return { refresh, ...(sha ? { commitSha: sha } : {}) };
          } catch (e) {
            for (const [p, text] of backups) {
              if (text === null) await fs.unlink(confined(root, p)).catch(() => {});
              else await writeContent(p, text);
            }
            throw e;
          }
        };
        return lockFiles(0);
      }),
    );
  } catch (e) {
    opts.signal?.throwIfAborted();
    const reason = publicErrorReason(e);
    if (host && /HTTP (401|403|429|451)|blocked|paywall/i.test(reason)) opts.blockedHosts?.set(host, reason);
    return { refresh: { ...base, reason } };
  }
}
