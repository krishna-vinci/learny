import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// TODO(T2 merge): import from @studium/shared
export interface CommitInfo {
  sha: string;
  date: string;
  author: string;
  subject: string;
}

export type Author = "tutor" | "user" | "system";

const AUTHOR_ENV: Record<Author, Record<string, string>> = {
  tutor: {
    GIT_AUTHOR_NAME: "Studium Tutor",
    GIT_AUTHOR_EMAIL: "tutor@studium.local",
    GIT_COMMITTER_NAME: "Studium Tutor",
    GIT_COMMITTER_EMAIL: "tutor@studium.local",
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

async function git(root: string, args: string[], env: Record<string, string> = {}): Promise<string> {
  const { stdout } = await execFileAsync("git", ["-C", root, "-c", "commit.gpgsign=false", ...args], {
    env: { ...process.env, ...env },
    maxBuffer: 16 * 1024 * 1024,
  });
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
    case "Studium Tutor":
      return "tutor";
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
  if (!existsSync(path.join(root, ".git"))) {
    await git(root, ["init", "-b", "main"]);
  }
  if (!(await repoHasCommits(root))) {
    await commitAll(root, "system: init study tree", "system");
  }
}

export async function commitAll(root: string, message: string, author: Author): Promise<string | null> {
  await git(root, ["add", "-A"]);
  const staged = await git(root, ["diff", "--cached", "--name-only"]);
  if (staged.trim() === "") {
    return null;
  }
  await git(root, ["commit", "-m", message], AUTHOR_ENV[author]);
  const sha = await git(root, ["rev-parse", "HEAD"]);
  return sha.trim();
}

export async function log(root: string, opts?: { path?: string; limit?: number }): Promise<CommitInfo[]> {
  const limit = opts?.limit ?? 50;
  const args = ["log", `--format=${LOG_FORMAT}`, "-n", String(limit)];
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
  try {
    await git(root, ["revert", "--no-edit", sha], AUTHOR_ENV[author]);
  } catch (cause) {
    await git(root, ["revert", "--abort"]).catch(() => undefined);
    throw new RevertConflictError(`Revert of ${sha} failed`, { cause });
  }
  const newSha = await git(root, ["rev-parse", "HEAD"]);
  return newSha.trim();
}
