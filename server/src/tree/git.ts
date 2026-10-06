import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { CommitInfo } from "@studium/shared";
import { concurrencyLimit } from "../concurrency.js";
import { resolveInRoot } from "./paths.js";

const execFileAsync = promisify(execFile);
// Shared across workspaces, including card staleness and Today activity queries.
const limitGit = concurrencyLimit(4);

export type Author =
  | "tutor"
  | "librarian"
  | "outliner"
  | "drafter"
  | "checker"
  | "cardsmith"
  | "critic"
  | "examiner"
  | "grader"
  | "user"
  | "system";

const AUTHOR_ENV: Record<Author, Record<string, string>> = {
  examiner: {
    GIT_AUTHOR_NAME: "Studium Examiner",
    GIT_AUTHOR_EMAIL: "examiner@studium.local",
    GIT_COMMITTER_NAME: "Studium Examiner",
    GIT_COMMITTER_EMAIL: "examiner@studium.local",
  },
  grader: {
    GIT_AUTHOR_NAME: "Studium Grader",
    GIT_AUTHOR_EMAIL: "grader@studium.local",
    GIT_COMMITTER_NAME: "Studium Grader",
    GIT_COMMITTER_EMAIL: "grader@studium.local",
  },
  outliner: {
    GIT_AUTHOR_NAME: "Studium Outliner",
    GIT_AUTHOR_EMAIL: "outliner@studium.local",
    GIT_COMMITTER_NAME: "Studium Outliner",
    GIT_COMMITTER_EMAIL: "outliner@studium.local",
  },
  tutor: {
    GIT_AUTHOR_NAME: "Studium Tutor",
    GIT_AUTHOR_EMAIL: "tutor@studium.local",
    GIT_COMMITTER_NAME: "Studium Tutor",
    GIT_COMMITTER_EMAIL: "tutor@studium.local",
  },
  librarian: {
    GIT_AUTHOR_NAME: "Studium Librarian",
    GIT_AUTHOR_EMAIL: "librarian@studium.local",
    GIT_COMMITTER_NAME: "Studium Librarian",
    GIT_COMMITTER_EMAIL: "librarian@studium.local",
  },
  drafter: {
    GIT_AUTHOR_NAME: "Studium Drafter",
    GIT_AUTHOR_EMAIL: "drafter@studium.local",
    GIT_COMMITTER_NAME: "Studium Drafter",
    GIT_COMMITTER_EMAIL: "drafter@studium.local",
  },
  checker: {
    GIT_AUTHOR_NAME: "Studium Checker",
    GIT_AUTHOR_EMAIL: "checker@studium.local",
    GIT_COMMITTER_NAME: "Studium Checker",
    GIT_COMMITTER_EMAIL: "checker@studium.local",
  },
  cardsmith: {
    GIT_AUTHOR_NAME: "Studium Cardsmith",
    GIT_AUTHOR_EMAIL: "cardsmith@studium.local",
    GIT_COMMITTER_NAME: "Studium Cardsmith",
    GIT_COMMITTER_EMAIL: "cardsmith@studium.local",
  },
  critic: {
    GIT_AUTHOR_NAME: "Studium Critic",
    GIT_AUTHOR_EMAIL: "critic@studium.local",
    GIT_COMMITTER_NAME: "Studium Critic",
    GIT_COMMITTER_EMAIL: "critic@studium.local",
  },
  user: {
    GIT_AUTHOR_NAME: "Studium User",
    GIT_AUTHOR_EMAIL: "user@studium.local",
    GIT_COMMITTER_NAME: "Studium User",
    GIT_COMMITTER_EMAIL: "user@studium.local",
  },
  system: {
    GIT_AUTHOR_NAME: "Studium",
    GIT_AUTHOR_EMAIL: "system@studium.local",
    GIT_COMMITTER_NAME: "Studium",
    GIT_COMMITTER_EMAIL: "system@studium.local",
  },
};

const SHA_PATTERN = /^[0-9a-f]{7,40}$/;
const LOG_FORMAT = "%H%x1f%aI%x1f%an%x1f%s%x1e";

const repoLocks = new Map<string, Promise<void>>();

/**
 * In-process async mutex per resolved study root. Git mutations share one
 * index, so add/commit/revert sequences for a repository must not interleave.
 * Waiters chain onto the tail of the lock map in call order (FIFO). Read-only
 * operations run without the lock.
 */
export function withRepoLock<T>(root: string, operation: () => Promise<T>): Promise<T> {
  const key = path.resolve(root);
  const previous = repoLocks.get(key) ?? Promise.resolve();
  const result = previous.then(operation);
  const tail = result.then(
    () => undefined,
    () => undefined,
  );
  repoLocks.set(key, tail);
  void tail.then(() => {
    if (repoLocks.get(key) === tail) repoLocks.delete(key);
  });
  return result;
}

export async function git(root: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  // Never let the caller's environment redirect git to another repo or run the user's global hooks.
  const { GIT_DIR: _dir, GIT_WORK_TREE: _tree, GIT_INDEX_FILE: _index, ...baseEnv } = process.env;
  const { stdout } = await limitGit(() =>
    execFileAsync("git", ["-C", root, "-c", "commit.gpgsign=false", "-c", "core.hooksPath=/dev/null", ...args], {
      env: { ...baseEnv, ...env },
      maxBuffer: 16 * 1024 * 1024,
    }),
  );
  return stdout;
}

async function repoHasCommits(root: string): Promise<boolean> {
  try {
    await git(root, ["rev-parse", "--verify", "HEAD"]);
    return true;
  } catch {
    return false;
  }
}

function mapAuthorName(name: string): string {
  switch (name) {
    case "Studium Examiner":
      return "examiner";
    case "Studium Grader":
      return "grader";
    case "Studium Tutor":
      return "tutor";
    case "Studium Librarian":
      return "librarian";
    case "Studium Outliner":
      return "outliner";
    case "Studium Drafter":
      return "drafter";
    case "Studium Checker":
      return "checker";
    case "Studium Cardsmith":
      return "cardsmith";
    case "Studium Critic":
      return "critic";
    case "Studium User":
      return "user";
    case "Studium":
      return "system";
    default:
      return name;
  }
}

function parseLog(output: string): CommitInfo[] {
  return output
    .split("\x1e")
    .map((record) => record.trim())
    .filter((record) => record !== "")
    .map((record) => {
      const [sha, date, authorName, subject] = record.split("\x1f");
      if (sha === undefined || date === undefined || authorName === undefined || subject === undefined) {
        throw new Error("Malformed git log output");
      }
      return {
        sha,
        date,
        author: mapAuthorName(authorName),
        subject,
      };
    });
}

export async function ensureRepo(root: string): Promise<void> {
  await withRepoLock(root, async () => {
    if (!existsSync(path.join(root, ".git"))) {
      await git(root, ["init", "-b", "main"]);
    }
    if (!(await repoHasCommits(root))) {
      await commitAllUnlocked(root, "system: init study tree", "system");
    }
  });
}

async function commitAllUnlocked(root: string, message: string, author: Author): Promise<string | null> {
  await git(root, ["add", "-A"]);
  const staged = await git(root, ["diff", "--cached", "--name-only"]);
  if (staged.trim() === "") {
    return null;
  }
  await git(root, ["commit", "-m", message], AUTHOR_ENV[author]);
  const sha = await git(root, ["rev-parse", "HEAD"]);
  return sha.trim();
}

export async function commitAll(root: string, message: string, author: Author): Promise<string | null> {
  return withRepoLock(root, () => commitAllUnlocked(root, message, author));
}

export async function commitPaths(
  root: string,
  paths: string[],
  message: string,
  author: Author,
): Promise<string | null> {
  for (const rel of paths) {
    resolveInRoot(root, rel);
  }
  if (paths.length === 0) {
    return null;
  }

  return withRepoLock(root, () => commitPathsUnlocked(root, paths, message, author));
}

export async function commitPathsUnlocked(
  root: string,
  paths: string[],
  message: string,
  author: Author,
  alreadyStaged = false,
): Promise<string | null> {
  // A path staged as deleted no longer exists on disk, so `git add` would reject its pathspec.
  if (!alreadyStaged) await git(root, ["--literal-pathspecs", "add", "-A", "--", ...paths]);
  const staged = await git(root, ["--literal-pathspecs", "diff", "--cached", "--name-only", "--", ...paths]);
  if (staged.trim() === "") {
    return null;
  }
  // A pathspec makes git commit only those paths, leaving unrelated staged
  // or unstaged changes out of the commit.
  await git(root, ["--literal-pathspecs", "commit", "-m", message, "--", ...paths], AUTHOR_ENV[author]);
  const sha = await git(root, ["rev-parse", "HEAD"]);
  return sha.trim();
}

/**
 * List files tracked in HEAD that match a gitignore pattern. Used to warn
 * when a repaired .gitignore came too late for already-committed files.
 */
export async function trackedFiles(root: string, ignorePattern: string): Promise<string[]> {
  // Gitignore patterns do not behave identically as pathspecs; adapt the
  // fixed shapes used by REQUIRED_IGNORES so ls-files matches the same files.
  const pathspec = ignorePattern.endsWith("/")
    ? `${ignorePattern}**`
    : ignorePattern.includes("/")
      ? ignorePattern
      : `**/${ignorePattern}`;
  const output = await git(root, ["ls-files", "--cached", "--", pathspec]);
  return output.split("\n").filter((line) => line !== "");
}

export async function log(
  root: string,
  opts?: { path?: string; limit?: number; author?: Author },
): Promise<CommitInfo[]> {
  const limit = opts?.limit ?? 50;
  const args = ["log", `--format=${LOG_FORMAT}`, "-n", String(limit)];
  if (opts?.author) {
    // Exact author name, anchored so "Studium User" never matches a longer name.
    const name = AUTHOR_ENV[opts.author].GIT_AUTHOR_NAME;
    args.push(`--author=^${name} <`);
  }
  if (opts?.path) {
    args.push("--", opts.path);
  }
  return parseLog(await git(root, args));
}

export async function diff(root: string, sha: string, path?: string): Promise<string> {
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(`Invalid commit sha: ${sha}`);
  }
  const args = ["show", "--format=", sha];
  if (path) {
    args.push("--", path);
  }
  return git(root, args);
}

export class RevertConflictError extends Error {
  constructor(message = "git revert failed", options?: ErrorOptions) {
    super(message, options);
    this.name = "RevertConflictError";
  }
}

export async function revert(root: string, sha: string, author: Author): Promise<string> {
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(`Invalid commit sha: ${sha}`);
  }
  return withRepoLock(root, () => revertUnlocked(root, sha, author));
}

/** Caller must hold the repository lock for the entire validation/revert transaction. */
export async function revertUnlocked(root: string, sha: string, author: Author): Promise<string> {
  try {
    await git(root, ["revert", "--no-edit", sha], AUTHOR_ENV[author]);
  } catch (cause) {
    await git(root, ["revert", "--abort"]).catch(() => undefined);
    throw new RevertConflictError(`Revert of ${sha} failed`, { cause });
  }
  const newSha = await git(root, ["rev-parse", "HEAD"]);
  return newSha.trim();
}

/**
 * Root-relative paths a commit changed. Renames are split into the old and
 * new path so callers can scope-check both sides.
 */
export async function changedPaths(root: string, sha: string): Promise<string[]> {
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(`Invalid commit sha: ${sha}`);
  }
  const output = await git(root, ["show", "--name-only", "--no-renames", "-z", "--format=", sha]);
  return output.split("\0").filter((entry) => entry !== "");
}

/**
 * Undo a commit for just `paths`: restore each path to its content in the
 * commit's parent (a path the parent did not have is removed), then commit
 * only those paths. Later edits to those paths are overwritten. Returns null
 * when the working tree already matches.
 */
export async function revertPaths(
  root: string,
  sha: string,
  paths: string[],
  message: string,
  author: Author,
): Promise<string | null> {
  if (!SHA_PATTERN.test(sha)) {
    throw new Error(`Invalid commit sha: ${sha}`);
  }
  for (const rel of paths) {
    resolveInRoot(root, rel);
  }
  if (paths.length === 0) {
    return null;
  }
  return withRepoLock(root, async () => {
    // Resolve every path's parent state before touching the tree.
    const inParent = new Map<string, boolean>();
    for (const rel of paths) {
      inParent.set(
        rel,
        await git(root, ["cat-file", "-e", `${sha}^:${rel}`]).then(
          () => true,
          async () => {
            // Missing path vs. missing parent commit: only the former is fine.
            await git(root, ["rev-parse", "--verify", `${sha}^`]);
            return false;
          },
        ),
      );
    }
    for (const rel of paths) {
      if (inParent.get(rel)) {
        await git(root, ["checkout", `${sha}^`, "--", rel]);
      } else {
        await git(root, ["rm", "-r", "-f", "--ignore-unmatch", "--quiet", "--", rel]);
      }
    }
    return commitPathsUnlocked(root, paths, message, author, true);
  });
}
