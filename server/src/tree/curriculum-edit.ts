import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import { parseFrontmatter } from "@studium/shared";
import { parseDocument } from "yaml";
import { z } from "zod";
import { slugify } from "../ingest/ids.js";
import { applyCurriculumOperation, chapterExists, parseCurriculum, serializeCurriculum } from "./curriculum.js";
import { EditError, readText, writeTextLocked } from "./edit.js";
import { commitPaths } from "./git.js";
import type { FileLocks } from "./lock.js";
import { mediaBriefPath } from "./media-brief.js";
import { canonicalRel, resolveInRoot } from "./paths.js";
import { isSetSlug, listNotes } from "./read.js";

const number = z.number().int().positive();
const chapter = z.object({
  title: z.string().min(1).max(200),
  scope: z.string().min(1).max(10000),
  prerequisites: z.string().max(1000),
  visuals: z.array(z.string().min(1).max(3000)).max(20),
  video: z.string().max(3000),
});
export const CurriculumEditRequest = z.intersection(
  z.object({ previous: z.string().max(1024 * 1024) }),
  z.discriminatedUnion("operation", [
    z.object({ operation: z.literal("update"), number, chapter }),
    z.object({ operation: z.literal("insert"), after: number.nullable(), chapter }),
    z.object({ operation: z.literal("delete"), number }),
    z.object({ operation: z.literal("move"), number, direction: z.enum(["up", "down"]) }),
  ]),
);

/** Update only named YAML keys, retaining note body, comments and unknown metadata. */
function patchMetadata(text: string, patch: Record<string, unknown>): string {
  const block = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  const document = parseDocument(block?.[1] ?? "");
  if (document.errors.length) throw new Error("Fix the linked file's YAML before editing this chapter");
  for (const [key, value] of Object.entries(patch)) document.set(key, value);
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const yaml = document.toString({ lineWidth: 0 }).replace(/\r?\n/g, eol);
  return `---${eol}${yaml}---${eol}${block ? text.slice(block[0].length) : text}`;
}

/** Set gate excludes other writers; every changed file also holds its normal file lock.
 * Snapshot destinations first, then apply as one user commit. Reverts restore identities too. */
interface CurriculumInstall {
  operation: "install";
  previous: string;
  content: string;
  origins: Record<string, string>;
  holder: string;
  extraWrites: Map<string, string | null>;
}

export async function editCurriculum(
  root: string,
  locks: FileLocks,
  set: string,
  request: z.infer<typeof CurriculumEditRequest> | CurriculumInstall,
) {
  if (!isSetSlug(set)) throw new Error("Invalid set");
  const rel = `${set}/curriculum.md`;
  const holder = request.operation === "install" ? request.holder : `user:curriculum:${randomUUID()}`;
  const run = async () => {
    if (canonicalRel(root, rel) !== rel) throw new Error("Curriculum symlinks are not allowed");
    let text = "";
    try {
      text = await readText(root, rel);
    } catch (error) {
      if (!(error instanceof EditError && error.code === "not_found")) throw error;
    }
    if (text !== request.previous) throw new EditError("conflict", "changed", text);
    const before = parseCurriculum(text);
    const after =
      request.operation === "install"
        ? parseCurriculum(request.content).map((chapter) => ({
            ...chapter,
            line:
              before.find((old) => old.title === (request.origins[String(chapter.number)] ?? chapter.title))?.line ??
              -1,
          }))
        : applyCurriculumOperation(text, request);
    const identities = after.filter((c) => c.line >= 0).map((c) => c.line);
    if (new Set(identities).size !== identities.length)
      throw new Error("Proposal maps multiple chapters to the same note identity");
    const writes = new Map<string, string | null>([
      [rel, request.operation === "install" ? request.content : serializeCurriculum(after, text)],
    ]);
    if (request.operation === "install") for (const [file, content] of request.extraWrites) writes.set(file, content);
    const notes = await listNotes(root, set);
    for (const chapter of before) {
      const next = after.find((c) => c.line === chapter.line);
      if (next?.title === chapter.title && next.number === chapter.number) continue;
      for (const note of notes.filter((n) => chapterExists(chapter, [n]))) {
        const noteRel = `${set}/${note.path}`;
        const noteText = await readText(root, noteRel);
        parseFrontmatter(noteText); // Never repair a corrupt linked note silently.
        writes.set(
          noteRel,
          patchMetadata(
            noteText,
            next
              ? { chapter: slugify(next.title, 40), order: next.number }
              : { chapter: `detached-${randomUUID()}`, order: null },
          ),
        );
      }
    }
    let media: import("node:fs").Dirent[] = [];
    try {
      media = await fs.readdir(resolveInRoot(root, `${set}/media`), { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const moves: { from: string; to: string | null; content: string }[] = [];
    for (const chapter of before) {
      const next = after.find((c) => c.line === chapter.line);
      const oldBase = mediaBriefPath(set, chapter).slice(0, -3);
      const newBase = next ? mediaBriefPath(set, next).slice(0, -3) : null;
      if (oldBase === newBase) continue;
      for (const entry of media) {
        const file = `${set}/media/${entry.name}`;
        if (file !== `${oldBase}.md` && !file.startsWith(`${oldBase}.`)) continue;
        if (!entry.isFile() || canonicalRel(root, file) !== file)
          throw new Error("Media brief symlinks are not allowed");
        moves.push({
          from: file,
          to: newBase === null ? null : newBase + file.slice(oldBase.length),
          content: await readText(root, file),
        });
      }
    }
    const sources = new Set(moves.map((move) => move.from));
    for (const move of moves) {
      writes.set(move.from, null);
      if (move.to && !sources.has(move.to)) {
        try {
          await fs.lstat(resolveInRoot(root, move.to));
          throw new Error("A media brief already occupies the destination; resolve it before editing");
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
    // Write destinations after marking sources, so swaps do not delete each other's briefs.
    for (const move of moves) if (move.to) writes.set(move.to, move.content);
    const paths = [...writes.keys()].sort();
    const lockAll = (
      i: number,
      fn: () => Promise<{ sha: string | null; subject: string }>,
    ): Promise<{ sha: string | null; subject: string }> => {
      const file = paths[i];
      if (!file) return fn();
      return locks.holderOf(file) === holder
        ? lockAll(i + 1, fn)
        : locks.withLock(file, holder, () => lockAll(i + 1, fn));
    };
    return lockAll(0, async () => {
      const previous = new Map<string, string | null>();
      for (const file of paths) {
        if (canonicalRel(root, file) !== file) throw new Error("Linked file symlinks are not allowed");
        try {
          previous.set(file, await readText(root, file));
        } catch (error) {
          if (!(error instanceof EditError && error.code === "not_found")) throw error;
          previous.set(file, null);
        }
      }
      const canWrite = (file: string) => writes.has(file);
      const apply = async (values: Map<string, string | null>) => {
        for (const [file, content] of values) {
          if (content === null)
            await fs.unlink(resolveInRoot(root, file)).catch((error: NodeJS.ErrnoException) => {
              if (error.code !== "ENOENT") throw error;
            });
          else await writeTextLocked(root, locks, holder, file, content, canWrite);
        }
      };
      const subject =
        request.operation === "install"
          ? "user: approve plan"
          : `user: ${request.operation} chapter${"number" in request ? ` ${request.number}` : ""}`;
      try {
        await apply(writes);
        const sha = await commitPaths(root, paths, subject, "user");
        return { sha, subject };
      } catch (error) {
        await apply(previous);
        throw error;
      }
    });
  };
  if (request.operation === "install") {
    if (locks.holderOf(rel) !== holder) throw new Error("Curriculum lock is required for approval");
    return run();
  }
  return locks.withSetLock(set, () => locks.withLock(rel, holder, run));
}
