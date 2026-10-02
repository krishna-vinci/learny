import { promises as fs } from "node:fs";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";
import { defineTool, type ModelRuntime, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { parseFrontmatter } from "@studium/shared";
import { parseYoutubeVideo } from "@studium/shared/media";
import { Type } from "typebox";
import { mediaWarnings } from "../agent/media-warnings.js";
import { noteLint } from "../agent/note-lint.js";
import { rethrowRoleModelError, runRole } from "../agent/run-role.js";
import type { EventHub } from "../events.js";
import { resolveDraftSources } from "../inbox/plan-sources.js";
import { slugify } from "../ingest/ids.js";
import type { McpManager } from "../mcp/bridge.js";
import { chapterExists, parseCurriculum } from "../tree/curriculum.js";
import { editFile, readText, writeTextLocked } from "../tree/edit.js";
import { commitPaths } from "../tree/git.js";
import type { FileLocks } from "../tree/lock.js";
import { isWritableByAgent, resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";
import type { DraftChapterInput } from "./proposals.js";
import type { JobContext, JobHandler } from "./runner.js";
import { usageFromPiMessages } from "./runner.js";

const NOTE_PATH = /^notes\/[0-9]{2,}-[a-z0-9][a-z0-9-]*\.md$/;
const SOURCE_ID = /^lib-[a-z0-9][a-z0-9-]*$/;

// Note numbers reserved by in-flight draft jobs, keyed by the set's notes dir.
const reservedNoteOrders = new Map<string, Set<number>>();

export interface DraftJobDeps {
  root: string;
  locks: FileLocks;
  mcp: McpManager;
  runtime: ModelRuntime;
  hub: EventHub;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseDraftChapterInput(value: unknown): DraftChapterInput {
  if (!isRecord(value)) throw new Error("invalid draft-chapter input");
  const set = typeof value.set === "string" ? value.set : "";
  const title = typeof value.title === "string" ? value.title.trim() : "";
  if (!isSetSlug(set)) throw new Error("invalid set");
  if (title === "") throw new Error("title is required");
  if (value.brief !== undefined && typeof value.brief !== "string") throw new Error("brief must be a string");
  if (
    value.sources !== undefined &&
    (!Array.isArray(value.sources) ||
      !value.sources.every((source) => typeof source === "string" && SOURCE_ID.test(source)))
  ) {
    throw new Error("sources must contain library source ids");
  }
  return {
    set,
    title,
    ...(typeof value.brief === "string" && value.brief !== "" ? { brief: value.brief } : {}),
    ...(Array.isArray(value.sources) ? { sources: [...value.sources] as string[] } : {}),
  };
}

export interface RewriteChapterInput {
  kind: "rewrite-chapter";
  set: string;
  path: string;
}

export function parseRewriteChapterInput(value: unknown): RewriteChapterInput {
  if (!isRecord(value) || !isSetSlug(typeof value.set === "string" ? value.set : "")) throw new Error("invalid set");
  if (typeof value.path !== "string" || !NOTE_PATH.test(value.path))
    throw new Error("path must be a chapter note path");
  return { kind: "rewrite-chapter", set: value.set as string, path: value.path };
}

/** A rewrite may change prose, not source identifiers, metadata or embedded figures. */
function validateRewrite(before: string, after: string): void {
  const metadata = (text: string) => {
    const { status: _status, ...fields } = parseFrontmatter(text).frontmatter;
    return fields;
  };
  if (!isDeepStrictEqual(metadata(before), metadata(after)))
    throw new Error("rewrite must preserve frontmatter fields");
  const preserved = [
    ...before.matchAll(/\[\^src:[^\]]+\]/g),
    ...before.matchAll(/!\[[^\]]*\]\(([^)]+)\)/g),
    ...before.matchAll(/^::(?:youtube|artifact)\{[^\n]+\}/gm),
    ...before.matchAll(/^(`{3,}|~{3,})(?:mermaid|vega-lite)\b[^\n]*\n[\s\S]*?^\1\s*$/gm),
  ];
  for (const match of preserved) {
    const value = match[1] && match[0].startsWith("![") ? match[1] : match[0];
    if (!after.includes(value)) throw new Error("rewrite must preserve citations and figures");
  }
  if (noteStatus(after) !== "draft") throw new Error("rewritten note must have status draft");
}

async function optionalText(root: string, rel: string): Promise<string> {
  try {
    return await readText(root, rel);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "not_found") return "";
    throw error;
  }
}

function noteSources(note: string): string[] {
  const sources = parseFrontmatter(note).frontmatter.sources;
  if (!Array.isArray(sources) || !sources.every((source) => typeof source === "string")) return [];
  return sources;
}

function noteStatus(note: string): string | null {
  const status = parseFrontmatter(note).frontmatter.status;
  return typeof status === "string" ? status : null;
}

function frontmatterStatusLine(text: string): string {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (block?.[1] === undefined) throw new Error("note has no valid frontmatter block");
  const frontmatter = block[1];
  const matches = frontmatter.match(/^status:\s*[^\r\n]+$/gm) ?? [];
  if (matches.length !== 1 || matches[0] === undefined) throw new Error("note must have exactly one status line");
  return matches[0];
}

export function hasBlockingIssues(report: string): boolean {
  return /^###\s+(?:\d+[.)]\s*)?Blocker\b/im.test(report);
}

async function setChecked(
  deps: Pick<DraftJobDeps, "root" | "locks">,
  noteRootPath: string,
  reportRootPath: string,
  holder: string,
  onWrite: (path: string) => void,
): Promise<void> {
  const report = await readText(deps.root, reportRootPath);
  if (hasBlockingIssues(report)) throw new Error("cannot mark a note checked while blocker issues remain");
  const note = await readText(deps.root, noteRootPath);
  if (noteLint(noteRootPath, note).length > 0)
    throw new Error("cannot mark a note checked while teaching lint hits remain");
  if ((await mediaWarnings(deps.root, noteRootPath, note)).some((warning) => warning.startsWith("Video source ")))
    throw new Error("cannot mark a note checked while a cited video is missing its watch link");
  if (noteStatus(note) === "checked") return;
  if (noteStatus(note) !== "draft") throw new Error("only a draft note can be marked checked");
  const oldLine = frontmatterStatusLine(note);
  await editFile(deps.root, deps.locks, holder, noteRootPath, oldLine, "status: checked", {
    canWrite: (candidate) => candidate === noteRootPath,
  });
  onWrite(noteRootPath);
}

export function setNoteStatusTool(opts: {
  root: string;
  locks: FileLocks;
  set: string;
  notePath: string;
  reportPath: string;
  holder: string;
  onWrite: (path: string) => void;
}): ToolDefinition {
  const noteRootPath = `${opts.set}/${opts.notePath}`;
  const reportRootPath = `${opts.set}/${opts.reportPath}`;
  return defineTool({
    name: "set_note_status",
    label: "Mark checked note",
    description: "Set this job's exact note to checked after the check report has no blocker issues.",
    parameters: Type.Object({ path: Type.Literal(opts.notePath), status: Type.Literal("checked") }),
    executionMode: "sequential" as const,
    async execute(_toolCallId, params) {
      try {
        if (params.path !== opts.notePath || params.status !== "checked")
          throw new Error("status target is not allowed");
        await setChecked(opts, noteRootPath, reportRootPath, opts.holder, opts.onWrite);
        const summary = `set ${opts.notePath} status to checked`;
        return {
          content: [{ type: "text" as const, text: summary }],
          details: { isError: false, summary, path: opts.notePath },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [{ type: "text" as const, text: `Error: ${message}` }],
          details: { isError: true, summary: message, path: opts.notePath },
        };
      }
    },
  });
}

/**
 * Reserve the next free `<set>/notes/NN-<slug>.md` for this draft before the
 * Drafter runs, so its write policy can be pinned to exactly that path.
 */
async function reserveNotePath(
  root: string,
  set: string,
  title: string,
  curriculum: string,
): Promise<{ notePath: string; release: () => void }> {
  const notesAbs = resolveInRoot(root, `${set}/notes`);
  let existing: string[] = [];
  try {
    existing = await fs.readdir(notesAbs);
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error;
  }

  const reserved = reservedNoteOrders.get(notesAbs) ?? new Set<number>();
  reservedNoteOrders.set(notesAbs, reserved);

  const used = new Set<number>(reserved);
  for (const name of existing) {
    const match = /^([0-9]+)-/.exec(name);
    if (match?.[1] !== undefined) used.add(Number.parseInt(match[1], 10));
  }
  let order = 1;
  for (const number of used) if (number >= order) order = number + 1;
  const chapter = parseCurriculum(curriculum).find((item) => slugify(item.title, 40) === slugify(title, 40));
  if (chapter !== undefined && chapterExists(chapter, existing))
    throw new Error("This chapter already has a note. Use rewrite-chapter to revise it.");
  if (chapter?.number !== null && chapter?.number !== undefined) {
    if (used.has(chapter.number)) throw new Error("This chapter is already being drafted.");
    order = chapter.number;
  }
  reserved.add(order);

  const slug = slugify(title, 40) || "note";
  const notePath = `notes/${String(order).padStart(2, "0")}-${slug}.md`;
  return { notePath, release: () => reserved.delete(order) };
}

async function videoSourceInstructions(root: string, sources: string[]): Promise<string> {
  const videos: string[] = [];
  for (const id of sources) {
    const { frontmatter } = parseFrontmatter(await readText(root, `library/${id}/source.md`));
    const video =
      frontmatter.type === "video" && typeof frontmatter.url === "string" ? parseYoutubeVideo(frontmatter.url) : null;
    if (video) videos.push(`${id}: https://www.youtube.com/watch?v=${video.id}`);
  }
  if (!videos.length) return "";
  return [
    "Registered video sources (exact IDs/URLs; do not substitute search results or example URLs):",
    ...videos,
    "For each video source used, include a descriptive Markdown watch link near the concept it supports.",
    "Choose a timestamp only from a <!-- t:N --> marker in the relevant parsed transcript; never invent timestamps.",
    "Use a timed link and [^src:<id>#tN] with a human-readable footnote when supported; otherwise link the whole video and cite [^src:<id>].",
    "Ordinary Markdown links also render as click-to-load players. Use ::youtube only when explicit start/end bounds are useful, and keep a Markdown link for portability.",
  ].join("\n");
}

function draftTask(
  input: DraftChapterInput,
  notePath: string,
  plan: string,
  curriculum: string,
  sources: string[],
  videoInstructions: string,
): string {
  return [
    "Load the draft-chapter, note-authoring and media-authoring skills, then draft one new chapter.",
    `Title: ${input.title}`,
    `Brief: ${input.brief ?? "Follow the approved plan and curriculum."}`,
    `Allowed source ids: ${sources.join(", ") || "(none)"}`,
    `Create exactly ${notePath} (this exact path was reserved for you) with status: draft.`,
    "You may also write assets/ and artifacts/ for this chapter. Do not modify other notes or files.",
    "Read source.md and parsed.md or parsed/*.md directly under library/<id>/ for support.",
    videoInstructions,
    "",
    "## PLAN.md",
    plan,
    "",
    "## curriculum.md",
    curriculum || "(not present)",
  ].join("\n");
}

function checkerTask(notePath: string, reportPath: string, sources: string[], recheck: boolean): string {
  return [
    "Load the fact-check skill and verify the target note against its cited parsed library sources.",
    `Target note: ${notePath}`,
    `Cited source ids: ${sources.join(", ") || "(none)"}`,
    `Write ${recheck ? "an updated" : "a"} report at ${reportPath}.`,
    recheck
      ? "Replace resolved findings in the existing report and list every remaining issue."
      : "Create the report using the skill's severity-ranked format.",
    "Check teaching quality as well as facts. All remaining teaching-lint hits are blockers. For rewrites, verify no facts, citations or figures were lost.",
    "If and only if no blocker remains, call set_note_status for the target note with status checked.",
  ].join("\n");
}

export async function tickCurriculum(
  deps: Pick<DraftJobDeps, "root" | "locks">,
  set: string,
  notePath: string,
  title: string,
): Promise<string | null> {
  const rel = `${set}/curriculum.md`;
  const holder = `drafter:curriculum:${crypto.randomUUID()}`;
  return deps.locks.withLock(rel, holder, async () => {
    const text = await optionalText(deps.root, rel);
    const chapters = parseCurriculum(text);
    const chapter =
      chapters.find((item) => slugify(item.title, 40) === slugify(title, 40)) ??
      chapters.find((item) => chapterExists(item, [notePath]));
    const notes = (await fs.readdir(resolveInRoot(deps.root, `${set}/notes`), { withFileTypes: true }))
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => `notes/${entry.name}`);
    const drafted = (item: (typeof chapters)[number]) => item === chapter || chapterExists(item, notes);
    const mismatches = chapters.filter((item) => item.checked !== drafted(item));
    if (mismatches.length === 0) return null;
    const lines = text.split("\n");
    for (const item of mismatches) {
      lines[item.line] = (lines[item.line] ?? "").replace(/\[[ xX]\]/, drafted(item) ? "[x]" : "[ ]");
    }
    await writeTextLocked(deps.root, deps.locks, holder, rel, lines.join("\n"), (candidate) => candidate === rel);
    return rel;
  });
}

export function createDraftJob(deps: DraftJobDeps): JobHandler {
  return createChapterJob(deps, false);
}

export function createRewriteJob(deps: DraftJobDeps): JobHandler {
  return createChapterJob(deps, true);
}

function createChapterJob(deps: DraftJobDeps, rewriting: boolean): JobHandler {
  return async (rawInput: unknown, ctx: JobContext) => {
    const rewrite = rewriting ? parseRewriteChapterInput(rawInput) : null;
    const original = rewrite ? await readText(deps.root, `${rewrite.set}/${rewrite.path}`) : null;
    const frontmatter = original === null ? null : parseFrontmatter(original).frontmatter;
    const input: DraftChapterInput = rewrite
      ? {
          set: rewrite.set,
          title: typeof frontmatter?.title === "string" ? frontmatter.title : path.basename(rewrite.path, ".md"),
          sources: noteSources(original ?? ""),
        }
      : parseDraftChapterInput(rawInput);
    if (rewrite) ctx.setTitle?.(input.title);
    const [plan, curriculum] = await Promise.all([
      readText(deps.root, `${input.set}/PLAN.md`),
      optionalText(deps.root, `${input.set}/curriculum.md`),
    ]);
    const sources = await resolveDraftSources(deps.root, plan, input.sources);
    const videoInstructions = await videoSourceInstructions(deps.root, sources);
    if (sources.length === 0) {
      throw new Error(
        "This set has no sources yet. Add a source in the Library (or ask the tutor to find some), then retry.",
      );
    }

    // Reserve the target path before the model runs so its write policy can be
    // pinned to exactly that file (create and, in revision, edit).
    const reserved = rewrite
      ? { notePath: rewrite.path, release: () => {} }
      : await reserveNotePath(deps.root, input.set, input.title, curriculum);
    const notePath = reserved.notePath;
    if (!NOTE_PATH.test(notePath)) throw new Error(`invalid reserved note path: ${notePath}`);
    const noteRootPath = `${input.set}/${notePath}`;
    const canWriteNote = (rel: string): boolean =>
      rel === noteRootPath ||
      (isWritableByAgent(rel) && (rel.startsWith(`${input.set}/assets/`) || rel.startsWith(`${input.set}/artifacts/`)));
    const reportPath = `log/checks/${path.basename(notePath)}`;
    const reportRootPath = `${input.set}/${reportPath}`;

    const validateCurrentRewrite = async () => {
      if (original === null) return;
      const current = await readText(deps.root, noteRootPath);
      try {
        validateRewrite(original, current);
      } catch (error) {
        // Restore only this rejected output using exact-string conflict protection.
        await editFile(
          deps.root,
          deps.locks,
          `drafter:restore:${crypto.randomUUID()}`,
          noteRootPath,
          current,
          original,
          { canWrite: canWriteNote },
        );
        throw error;
      }
    };
    try {
      ctx.signal.throwIfAborted();
      ctx.progress(rewriting ? "Rewriting chapter" : "Drafting chapter");
      const draft = await runRole("drafter", {
        root: deps.root,
        set: input.set,
        task: rewriting
          ? [
              "Load the draft-chapter, note-authoring and media-authoring skills and the plan subject guide.",
              `Rewrite ${notePath} in place in the warm teaching voice. Read the existing note first.`,
              "Keep all facts, citation identifiers, figures and frontmatter fields; reset status to draft.",
              "Fix footnote text to author/organisation, title, section/page; remove internal paths and line numbers.",
              "Use the flexible chapter shape, including Check yourself with collapsed Answers and Key takeaways.",
              `Only ${notePath}, assets/ and artifacts/ are writable. Do not create another chapter.`,
              `Allowed source ids: ${sources.join(", ")}`,
              "Verify retained claims against their registered library sources.",
              videoInstructions,
              "## PLAN.md",
              plan,
              "## curriculum.md",
              curriculum,
            ].join("\n")
          : draftTask(input, notePath, plan, curriculum, sources, videoInstructions),
        locks: deps.locks,
        mcp: deps.mcp,
        runtime: deps.runtime,
        hub: deps.hub,
        signal: ctx.signal,
        canWrite: canWriteNote,
        onModel: (provider) => ctx.useProvider?.(provider),
        onFallback: (_from, to) => ctx.progress(`Drafter model rate-limited; using ${to}`),
        onWrite: () => {},
      }).catch(rethrowRoleModelError);
      ctx.addUsage(usageFromPiMessages(draft.messages));
      if (draft.written.length === 0) {
        throw new Error(`The drafter stopped without writing the chapter: ${draft.text.trim().slice(0, 300)}`);
      }
      if (!draft.written.includes(noteRootPath) || draft.written.some((rel) => !canWriteNote(rel))) {
        throw new Error(`drafter must create exactly ${notePath}`);
      }

      await validateCurrentRewrite();

      // Commit the draft as the drafter before the checker edits its status, so the
      // checker's commit below carries the report and the `status: checked` edit.
      ctx.signal.throwIfAborted();
      const curriculumPath = await tickCurriculum(deps, input.set, notePath, input.title);
      const drafterSha = await commitPaths(
        deps.root,
        [...draft.written, ...(curriculumPath ? [curriculumPath] : [])],
        `drafter: ${input.title}`,
        "drafter",
      );
      if (drafterSha === null) throw new Error("draft job produced no changes to commit");
      deps.hub.publish({ type: "commit", sha: drafterSha, subject: `drafter: ${input.title}`, author: "drafter" });

      const check = async (recheck: boolean): Promise<boolean> => {
        ctx.signal.throwIfAborted();
        ctx.progress(recheck ? "Re-checking revised chapter" : "Checking chapter");
        const currentNote = await readText(deps.root, noteRootPath);
        if (noteStatus(currentNote) !== "draft") {
          throw new Error("drafted note must have status draft");
        }
        const statusTool = setNoteStatusTool({
          root: deps.root,
          locks: deps.locks,
          set: input.set,
          notePath,
          reportPath,
          holder: `checker:${crypto.randomUUID()}`,
          onWrite: () => {},
        });
        const result = await runRole("checker", {
          root: deps.root,
          set: input.set,
          task: checkerTask(notePath, reportPath, noteSources(currentNote), recheck),
          locks: deps.locks,
          mcp: deps.mcp,
          runtime: deps.runtime,
          hub: deps.hub,
          signal: ctx.signal,
          onModel: (provider) => ctx.useProvider?.(provider),
          onFallback: (_from, to) => ctx.progress(`Checker model rate-limited; using ${to}`),
          onWrite: () => {},
          extraTools: [statusTool],
        }).catch(rethrowRoleModelError);
        ctx.addUsage(usageFromPiMessages(result.messages));
        let report = await readText(deps.root, reportRootPath);
        const checkedNote = await readText(deps.root, noteRootPath);
        const lint = [
          ...noteLint(noteRootPath, checkedNote),
          ...(await mediaWarnings(deps.root, noteRootPath, checkedNote)).filter((warning) =>
            warning.startsWith("Video source "),
          ),
        ];
        if (lint.length > 0 && !hasBlockingIssues(report)) {
          report += `\n## Teaching quality\n\n${lint.map((warning, i) => `### ${i + 1}. Blocker — ${warning}`).join("\n\n")}\n`;
          const holder = `checker:lint:${crypto.randomUUID()}`;
          await deps.locks.withLock(reportRootPath, holder, () =>
            writeTextLocked(deps.root, deps.locks, holder, reportRootPath, report, (rel) => rel === reportRootPath),
          );
        }
        const blocked = hasBlockingIssues(report);
        if (!blocked) {
          ctx.signal.throwIfAborted();
          await setChecked(deps, noteRootPath, reportRootPath, `checker:${crypto.randomUUID()}`, () => {});
        }
        return blocked;
      };

      const mediaWritten: string[] = [];
      let blocked = await check(false);
      if (blocked) {
        ctx.signal.throwIfAborted();
        ctx.progress("Revising blocker issues");
        const revision = await runRole("drafter", {
          root: deps.root,
          set: input.set,
          task: [
            "Load the draft-chapter, note-authoring and media-authoring skills.",
            `Revise ${notePath} surgically to resolve every blocker in ${reportPath}.`,
            "Preserve correct content and citations, and keep status: draft for re-checking.",
            videoInstructions,
          ].join("\n"),
          locks: deps.locks,
          mcp: deps.mcp,
          runtime: deps.runtime,
          hub: deps.hub,
          signal: ctx.signal,
          canWrite: canWriteNote,
          onModel: (provider) => ctx.useProvider?.(provider),
          onFallback: (_from, to) => ctx.progress(`Drafter model rate-limited; using ${to}`),
          onWrite: () => {},
        }).catch(rethrowRoleModelError);
        mediaWritten.push(...revision.written.filter((rel) => rel !== noteRootPath));
        ctx.addUsage(usageFromPiMessages(revision.messages));
        if (revision.written.some((file) => !canWriteNote(file))) {
          throw new Error("revision must only edit the reserved note");
        }
        await validateCurrentRewrite();
        blocked = await check(true);
      }

      ctx.progress(blocked ? "Finished with open blocker issues" : "Chapter checked");
      ctx.signal.throwIfAborted();
      const checkerSha = await commitPaths(
        deps.root,
        [noteRootPath, reportRootPath, ...mediaWritten],
        `checker: ${input.title}`,
        "checker",
      );
      if (checkerSha !== null) {
        deps.hub.publish({ type: "commit", sha: checkerSha, subject: `checker: ${input.title}`, author: "checker" });
      }
      const commitSha = checkerSha ?? drafterSha;
      return { notePath, commitSha };
    } finally {
      reserved.release();
    }
  };
}
