import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { DeletedItem, DeletionPreview, DeletionResult } from "@studium/shared";
import { parseCardFile, parseFrontmatter } from "@studium/shared";
import { chapterExists, parseCurriculum } from "./curriculum.js";
import { exclusiveMedia } from "./deletion-media.js";
import { changedPaths, commitPathsUnlocked, git, revertUnlocked, withRepoLock } from "./git.js";
import type { FileLocks } from "./lock.js";
import { mediaBriefPath } from "./media-brief.js";
import { canonicalRel, PathError, resolveInRoot } from "./paths.js";
import { isSetSlug } from "./read.js";

const NOTE = /^notes\/[a-z0-9][a-z0-9._-]*\.md$/;
const MARKER = "Studium-Deletion: ";
const SHA = /^[a-f0-9]{40}$/;

export class DeletionError extends Error {
  constructor(
    readonly status: 400 | 404 | 409,
    message: string,
  ) {
    super(message);
  }
}

type Target = { set: string; path?: string };
type RecordData = Omit<DeletedItem, "sha" | "date">;
type Prepared = {
  preview: DeletionPreview;
  files: Map<string, Buffer>;
  removed: Set<string>;
  curriculum?: { rel: string; bytes: Buffer };
};

/** Reject every symlink component, including dangling links and aliases into other sets.
 * Restore checks missing paths against the same existing-ancestor policy.
 */
export async function confinedDeletionPath(root: string, set: string, rel: string): Promise<string> {
  if (
    !isSetSlug(set) ||
    (rel !== set && !rel.startsWith(`${set}/`)) ||
    rel.split("/").some((part) => !part || part === "." || part === ".." || part === ".git") ||
    /[\\\0]/.test(rel)
  )
    throw new PathError("Invalid deletion path");
  const abs = resolveInRoot(root, rel);
  let current = root;
  for (const part of rel.split("/")) {
    current = path.join(current, part);
    try {
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new PathError("Symlinks cannot be deleted or restored");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") break;
      throw error;
    }
  }
  if (canonicalRel(root, rel) !== rel) throw new PathError("Deletion path must be canonical");
  return abs;
}

async function validateTree(root: string, set: string, rel = set): Promise<void> {
  const abs = await confinedDeletionPath(root, set, rel);
  const stat = await fs.lstat(abs);
  if (!stat.isDirectory()) {
    if (!stat.isFile()) throw new PathError("Only regular files can be deleted");
    return;
  }
  for (const entry of await fs.readdir(abs)) await validateTree(root, set, `${rel}/${entry}`);
}

function frontmatter(bytes: Buffer | undefined): Record<string, unknown> {
  try {
    return parseFrontmatter(bytes?.toString("utf8") ?? "").frontmatter;
  } catch {
    return {};
  }
}
function titleOf(bytes: Buffer | undefined, fallback: string): string {
  const title = frontmatter(bytes).title;
  return typeof title === "string" && title.trim() ? title.trim().replace(/\s+/g, " ") : fallback;
}

async function pathsInSet(root: string, set: string, ignored = false): Promise<string[]> {
  const output = await git(root, [
    "--literal-pathspecs",
    "ls-files",
    ...(ignored ? ["--others", "--ignored"] : ["--cached", "--others"]),
    "--exclude-standard",
    "-z",
    "--",
    set,
  ]);
  return [...new Set(output.split("\0").filter(Boolean))].sort();
}

function withDeletionLocks<T>(locks: FileLocks, paths: readonly string[], fn: () => Promise<T>): Promise<T> {
  const ordered = [...paths].sort();
  const next = (index: number): Promise<T> => {
    const rel = ordered[index];
    return rel === undefined ? fn() : locks.withLock(rel, "user", () => next(index + 1));
  };
  return next(0);
}

async function prepare(root: string, target: Target, removeFromPlan = false): Promise<Prepared> {
  const { set, path: notePath } = target;
  if (!isSetSlug(set) || (notePath !== undefined && !NOTE.test(notePath)))
    throw new PathError("Invalid deletion target");
  await validateTree(root, set).catch((error) => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT")
      throw new DeletionError(404, "This study set no longer exists.");
    throw error;
  });
  const ignored = [
    ...new Set([
      ...(await pathsInSet(root, set, true)),
      ...(
        await git(root, [
          "--literal-pathspecs",
          "ls-files",
          "--cached",
          "--ignored",
          "--exclude-standard",
          "-z",
          "--",
          set,
        ])
      )
        .split("\0")
        .filter(Boolean),
    ]),
  ].sort();
  const files = new Map<string, Buffer>();
  for (const rel of await pathsInSet(root, set)) {
    if (ignored.includes(rel)) continue;
    const abs = await confinedDeletionPath(root, set, rel);
    try {
      files.set(rel, await fs.readFile(abs));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  if (!files.has(`${set}/PLAN.md`)) throw new DeletionError(404, "This study set no longer exists.");
  const removed = new Set<string>();
  const cards = new Set<string>();
  let exportedCards = 0;
  let highlights = 0;
  let chapter = false;
  let chapterBecomesPlanned = false;
  let curriculum: Prepared["curriculum"];
  const note = notePath === undefined ? undefined : `${set}/${notePath}`;
  if (note && !files.has(note)) throw new DeletionError(404, "This note no longer exists.");

  for (const [rel, bytes] of files) {
    if (!rel.startsWith(`${set}/cards/`) || !rel.endsWith(".md")) continue;
    let associated = notePath === undefined;
    try {
      const parsed = parseCardFile(bytes.toString("utf8"));
      associated ||=
        parsed.note === notePath ||
        (parsed.note === null && rel === `${set}/cards/${path.posix.basename(notePath ?? "")}`);
    } catch {
      associated ||= rel === `${set}/cards/${path.posix.basename(notePath ?? "")}`;
    }
    if (associated) {
      cards.add(rel);
      removed.add(rel);
      // Count export markers even in legacy/malformed sections. Anki is never contacted.
      exportedCards += [...bytes.toString("utf8").matchAll(/<!--[^\n]*\b(?:status:\s*exported|anki:\s*\d+)[^\n]*-->/g)]
        .length;
    }
  }
  if (notePath === undefined) {
    for (const rel of files.keys()) removed.add(rel);
    highlights = [...files.keys()].filter((rel) => rel.startsWith(`${set}/highlights/`)).length;
  } else if (note) {
    removed.add(note);
    const highlight = `${set}/highlights/${path.posix.basename(notePath)}.json`;
    if (files.has(highlight)) {
      removed.add(highlight);
      highlights = 1;
    }
    const fm = frontmatter(files.get(note));
    const identity = {
      path: notePath,
      title: titleOf(files.get(note), notePath),
      ...(typeof fm.chapter === "string" ? { chapter: fm.chapter } : {}),
    };
    const curriculumRel = `${set}/curriculum.md`;
    const original = files.get(curriculumRel)?.toString("utf8");
    const chapters = parseCurriculum(original ?? null);
    const remainingNotes = [...files]
      .filter(([rel]) => rel.startsWith(`${set}/notes/`) && rel !== note && rel.endsWith(".md"))
      .map(([rel, bytes]) => ({
        path: rel.slice(set.length + 1),
        title: titleOf(bytes, rel),
        ...(typeof frontmatter(bytes).chapter === "string" ? { chapter: frontmatter(bytes).chapter as string } : {}),
      }));
    const matches = chapters.filter((row) => chapterExists(row, [identity]));
    chapter = matches.length > 0;
    chapterBecomesPlanned = matches.some((row) => !chapterExists(row, remainingNotes));
    for (const row of matches) {
      if (chapterExists(row, remainingNotes)) {
        if (removeFromPlan)
          throw new DeletionError(409, "Another note belongs to this chapter. Keep its place in the plan.");
        continue;
      }
      const brief = mediaBriefPath(set, row);
      if (files.has(brief)) removed.add(brief);
    }
    // Also clean briefs left under an earlier chapter number after re-planning.
    for (const [rel, bytes] of files) {
      if (!rel.startsWith(`${set}/media/`) || !rel.endsWith(".md")) continue;
      const briefChapter = frontmatter(bytes).chapter;
      if (
        typeof briefChapter === "string" &&
        chapterExists({ title: briefChapter } as (typeof chapters)[number], [identity]) &&
        !chapterExists({ title: briefChapter } as (typeof chapters)[number], remainingNotes)
      )
        removed.add(rel);
    }
    if (removeFromPlan && original !== undefined && matches.length > 0) {
      const lines = original.match(/[^\n]*(?:\n|$)/g)?.filter(Boolean) ?? [];
      const skip = new Set<number>();
      for (const row of matches) {
        skip.add(row.line);
        for (let i = row.line + 1; i < lines.length; i++) {
          if (!/^\s*(?:\r?\n)?$/.test(lines[i] ?? "") && !/^[ \t]+\S/.test(lines[i] ?? "")) break;
          // Preserve blank separators; remove only the indented chapter brief.
          if (/^[ \t]+\S/.test(lines[i] ?? "")) skip.add(i);
        }
      }
      curriculum = { rel: curriculumRel, bytes: Buffer.from(lines.filter((_, i) => !skip.has(i)).join("")) };
    }
    for (const rel of exclusiveMedia(files, removed)) removed.add(rel);
  }
  const hash = createHash("sha256");
  hash.update(JSON.stringify({ target, ignored }));
  for (const [rel, bytes] of files) {
    hash.update(rel);
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }
  return {
    files,
    removed,
    ...(curriculum ? { curriculum } : {}),
    preview: {
      kind: notePath === undefined ? "set" : "note",
      set,
      ...(notePath === undefined ? {} : { path: notePath }),
      title: titleOf(files.get(note ?? `${set}/PLAN.md`), notePath ?? set),
      token: hash.digest("hex"),
      files: removed.size,
      cardFiles: cards.size,
      exportedCards,
      highlights,
      chapter,
      chapterBecomesPlanned,
      mediaFiles: [...removed].filter((rel) => /^[^/]+\/(assets|artifacts|visuals|media)\//.test(rel)).length,
      retainedIgnoredFiles: notePath === undefined ? ignored.length : 0,
      practiceHistoryKept: [...files.keys()].some(
        (rel) =>
          rel.startsWith(`${set}/practice/`) || rel === `${set}/log/practice.jsonl` || rel === `${set}/log/quiz.md`,
      ),
    },
  };
}

export async function previewDeletion(root: string, locks: FileLocks, target: Target): Promise<DeletionPreview> {
  return locks.withSetLock(target.set, async () => (await prepare(root, target)).preview);
}

export async function deleteFromTree(
  root: string,
  locks: FileLocks,
  target: Target,
  options: {
    token: string;
    confirmation?: string;
    removeFromPlan?: boolean;
    linkedDataConfirmed?: boolean;
    assertIdle?: () => void;
  },
): Promise<DeletionResult> {
  return locks.withSetLock(target.set, () =>
    withRepoLock(root, async () => {
      options.assertIdle?.();
      const prepared = await prepare(root, target, options.removeFromPlan);
      const { preview, files, removed, curriculum } = prepared;
      if (preview.token !== options.token)
        throw new DeletionError(409, "This study set changed. Review what will be deleted and try again.");
      if (preview.kind === "set" && options.confirmation !== preview.title)
        throw new DeletionError(400, "Type the study set name to confirm deletion.");
      if (preview.kind === "note" && removed.size > 1 && !options.linkedDataConfirmed)
        throw new DeletionError(409, "Confirm deletion of the linked cards, highlights or media first.");
      const paths = [...removed, ...(curriculum ? [curriculum.rel] : [])].sort();
      options.assertIdle?.();
      return withDeletionLocks(locks, paths, async () => {
        // A fresh manual file or unsaved external edit must be captured before its deletion.
        await commitPathsUnlocked(root, paths, `user: save before deleting ${preview.title}`, "user");
        const record: RecordData = {
          kind: preview.kind,
          set: preview.set,
          ...(preview.path ? { path: preview.path } : {}),
          title: preview.title,
          exportedCards: preview.exportedCards,
          retainedIgnoredFiles: preview.retainedIgnoredFiles,
        };
        const subject = `user: delete ${preview.kind} ${preview.title}`;
        try {
          // Recheck confinement immediately before unlinking, while the file scope is exclusive.
          for (const rel of paths) await confinedDeletionPath(root, target.set, rel);
          for (const rel of removed) await fs.unlink(await confinedDeletionPath(root, target.set, rel));
          if (curriculum)
            await fs.writeFile(await confinedDeletionPath(root, target.set, curriculum.rel), curriculum.bytes);
          const sha = await commitPathsUnlocked(
            root,
            paths,
            `${subject}\n\n${MARKER}${JSON.stringify(record)}`,
            "user",
          );
          if (!sha) throw new Error("Deletion did not produce a commit");
          if (preview.kind === "set") {
            locks.setDeleted(target.set, true);
            await pruneEmptyDirectories(root, target.set).catch(() => undefined);
          }
          return { sha, subject, preview };
        } catch (error) {
          for (const rel of paths) {
            const bytes = files.get(rel);
            if (!bytes) continue;
            const abs = await confinedDeletionPath(root, target.set, rel);
            await fs.mkdir(path.dirname(abs), { recursive: true });
            await fs.writeFile(abs, bytes);
          }
          // Repair only this transaction's index entries, without resetting history or other paths.
          await git(root, ["--literal-pathspecs", "add", "-A", "--", ...paths]).catch(() => undefined);
          throw error;
        }
      });
    }),
  );
}

async function pruneEmptyDirectories(root: string, set: string, rel = set): Promise<void> {
  const abs = await confinedDeletionPath(root, set, rel);
  for (const entry of await fs.readdir(abs, { withFileTypes: true })) {
    if (entry.isDirectory()) await pruneEmptyDirectories(root, set, `${rel}/${entry.name}`);
  }
  await fs.rmdir(abs).catch((error) => {
    if (error.code !== "ENOTEMPTY" && error.code !== "ENOENT") throw error;
  });
}

async function deletionRecord(root: string, sha: string): Promise<RecordData> {
  if (!SHA.test(sha)) throw new DeletionError(400, "Invalid deletion history entry.");
  try {
    await git(root, ["merge-base", "--is-ancestor", sha, "HEAD"]);
  } catch {
    throw new DeletionError(400, "This deletion is not in your history.");
  }
  if ((await git(root, ["show", "-s", "--format=%an", sha])).trim() !== "Studium User")
    throw new DeletionError(400, "This is not a learner deletion.");
  const message = await git(root, ["show", "-s", "--format=%B", sha]);
  const raw = message
    .split("\n")
    .find((line) => line.startsWith(MARKER))
    ?.slice(MARKER.length);
  let data: RecordData;
  try {
    data = JSON.parse(raw ?? "") as RecordData;
  } catch {
    throw new DeletionError(400, "This is not a deletion history entry.");
  }
  if (
    !isSetSlug(data.set) ||
    (data.kind !== "set" && data.kind !== "note") ||
    typeof data.title !== "string" ||
    (data.kind === "note" ? typeof data.path !== "string" || !NOTE.test(data.path) : data.path !== undefined)
  )
    throw new DeletionError(400, "Invalid deletion history entry.");
  const changes = await changedPaths(root, sha);
  if (!changes.length || changes.some((rel) => !rel.startsWith(`${data.set}/`)))
    throw new PathError("Deletion history crosses sets");
  // Never restore a symlink (including a pre-existing one stored in history).
  const tree = await git(root, ["ls-tree", "-r", `${sha}^`, "--", ...changes]);
  if (tree.split("\n").some((line) => line.startsWith("120000 ") || line.startsWith("160000 ")))
    throw new PathError("Unsafe deletion history");
  return data;
}

async function restoredShas(root: string): Promise<Set<string>> {
  const messages = await git(root, ["log", "--format=%B%x00", "--fixed-strings", "--grep=This reverts commit"]);
  return new Set(
    Array.from(messages.matchAll(/^This reverts commit ([a-f0-9]{40})\.$/gm), (match) => match[1] as string),
  );
}

export async function recentlyDeleted(root: string): Promise<DeletedItem[]> {
  const restored = await restoredShas(root);
  const shas = (await git(root, ["log", "--format=%H", "--fixed-strings", `--grep=${MARKER}`]))
    .trim()
    .split("\n")
    .filter(Boolean);
  const items: DeletedItem[] = [];
  for (const sha of shas) {
    if (restored.has(sha)) continue;
    const data = await deletionRecord(root, sha);
    // A new/re-drafted file at this identity is a conflict, still offered with an explanatory error.
    const date = (await git(root, ["show", "-s", "--format=%aI", sha])).trim();
    items.push({ ...data, sha, date });
  }
  return items;
}

export async function restoreDeletion(
  root: string,
  locks: FileLocks,
  set: string,
  sha: string,
  assertIdle?: () => void,
): Promise<{ sha: string; subject: string }> {
  if (!isSetSlug(set)) throw new PathError("Invalid set");
  return locks.withSetLock(set, () =>
    withRepoLock(root, async () => {
      assertIdle?.();
      const data = await deletionRecord(root, sha);
      if (data.kind === "note") {
        try {
          await fs.access(await confinedDeletionPath(root, set, `${set}/PLAN.md`));
        } catch {
          throw new DeletionError(409, "Restore the study set before restoring this note.");
        }
      }
      if (data.set !== set) throw new PathError("Deletion belongs to another set");
      if ((await restoredShas(root)).has(sha)) throw new DeletionError(409, "This item has already been restored.");
      const changes = await changedPaths(root, sha);
      return withDeletionLocks(locks, changes, async () => {
        for (const rel of changes) await confinedDeletionPath(root, set, rel);
        // Reject recreated targets, even when their bytes equal the old note. Never overwrite new work.
        const deleted = (
          await git(root, [
            "diff-tree",
            "--no-commit-id",
            "--no-renames",
            "--diff-filter=D",
            "--name-only",
            "-r",
            "-z",
            sha,
          ])
        )
          .split("\0")
          .filter(Boolean);
        for (const rel of deleted) {
          try {
            await fs.lstat(await confinedDeletionPath(root, set, rel));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
            throw error;
          }
          throw new DeletionError(409, "New content exists where this item was deleted. Move it before restoring.");
        }
        const subject = `user: restore ${data.kind} ${data.title}`;
        // The actual restore is a git revert, appending one user-authored commit.
        if ((await git(root, ["diff", "--cached", "--name-only"])).trim())
          throw new DeletionError(409, "There are staged file edits. Save them before restoring.");
        const newSha = await revertUnlocked(root, sha, "user");
        locks.setDeleted(set, false);
        return { sha: newSha, subject };
      });
    }),
  );
}
