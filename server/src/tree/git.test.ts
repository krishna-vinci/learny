import { execFile as execFileCb } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type Author, commitAll, commitPaths, diff, ensureRepo, log, RevertConflictError, revert } from "./git";

const execFile = promisify(execFileCb);

async function rawGit(root: string, ...args: string[]): Promise<string> {
  const { stdout } = await execFile("git", ["-C", root, "-c", "commit.gpgsign=false", ...args]);
  return stdout.trim();
}

function requireSha(sha: string | null): string {
  if (sha === null) {
    throw new Error("expected commitAll to return a sha");
  }
  return sha;
}

describe("study-tree git wrapper", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(path.join(tmpdir(), "studium-git-"));
    await writeFile(path.join(root, "a.md"), "one\n");
    await writeFile(path.join(root, "b.md"), "bee\n");
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("ensureRepo initializes main and creates the initial system commit", async () => {
    await ensureRepo(root);

    expect(await rawGit(root, "rev-parse", "--abbrev-ref", "HEAD")).toBe("main");
    const commits = await log(root);
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({
      author: "system",
      subject: "system: init study tree",
    });
    expect(commits[0]?.sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it("commitAll returns null when the tree is clean", async () => {
    await ensureRepo(root);
    await expect(commitAll(root, "no-op", "user")).resolves.toBeNull();
    expect(await log(root)).toHaveLength(1);
  });

  it("commitAll stages changes and deletions and returns the full sha", async () => {
    await ensureRepo(root);
    await writeFile(path.join(root, "a.md"), "one\ntwo\n");
    await rm(path.join(root, "b.md"));

    const sha = await commitAll(root, "tutor: update notes", "tutor");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await rawGit(root, "status", "--porcelain")).toBe("");

    const [latest] = await log(root);
    expect(latest).toMatchObject({ sha, author: "tutor", subject: "tutor: update notes" });
    expect(await rawGit(root, "log", "-1", "--format=%an%x1f%ae%x1f%cn%x1f%ce")).toBe(
      "Studium Tutor\x1ftutor@studium.local\x1fStudium Tutor\x1ftutor@studium.local",
    );
  });

  it.each<[Author, string, string]>([
    ["librarian", "Studium Librarian", "librarian@studium.local"],
    ["drafter", "Studium Drafter", "drafter@studium.local"],
    ["checker", "Studium Checker", "checker@studium.local"],
    ["cardsmith", "Studium Cardsmith", "cardsmith@studium.local"],
    ["critic", "Studium Critic", "critic@studium.local"],
  ])("uses the %s git identity", async (author, name, email) => {
    await ensureRepo(root);
    await writeFile(path.join(root, "a.md"), `one\n${author}\n`);

    await commitPaths(root, ["a.md"], `${author}: update`, author);

    expect(await rawGit(root, "log", "-1", "--format=%an%x1f%ae%x1f%cn%x1f%ce")).toBe(
      `${name}\x1f${email}\x1f${name}\x1f${email}`,
    );
    expect((await log(root, { limit: 1 }))[0]).toMatchObject({ author, subject: `${author}: update` });
  });

  it("runs concurrent scoped commits on different files without losing either", async () => {
    await ensureRepo(root);
    await writeFile(path.join(root, "a.md"), "one\nscoped\n");
    await writeFile(path.join(root, "b.md"), "bee\nscoped\n");

    const [shaA, shaB] = await Promise.all([
      commitPaths(root, ["a.md"], "change a", "tutor"),
      commitPaths(root, ["b.md"], "change b", "tutor"),
    ]);

    expect(shaA).toMatch(/^[0-9a-f]{40}$/);
    expect(shaB).toMatch(/^[0-9a-f]{40}$/);
    expect(shaA).not.toBe(shaB);

    const subjects = (await log(root, { limit: 3 })).map((commit) => commit.subject);
    expect(subjects).toEqual(expect.arrayContaining(["change a", "change b"]));
    expect(await rawGit(root, "show", "--name-only", "--format=", requireSha(shaA))).toBe("a.md");
    expect(await rawGit(root, "show", "--name-only", "--format=", requireSha(shaB))).toBe("b.md");
    expect(await rawGit(root, "status", "--porcelain")).toBe("");
  });

  it("commitPaths leaves an unrelated modified file uncommitted", async () => {
    await ensureRepo(root);
    await writeFile(path.join(root, "a.md"), "one\nscoped\n");
    await writeFile(path.join(root, "b.md"), "bee\nunrelated\n");

    const sha = await commitPaths(root, ["a.md"], "change a", "tutor");

    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(await rawGit(root, "show", "--name-only", "--format=", requireSha(sha))).toBe("a.md");
    expect(await rawGit(root, "status", "--porcelain")).toContain("b.md");
    expect(await readFile(path.join(root, "b.md"), "utf8")).toBe("bee\nunrelated\n");
  });

  it("log filters by path and honors the limit", async () => {
    await ensureRepo(root);
    await writeFile(path.join(root, "a.md"), "one\nchanged\n");
    const aSha = await commitAll(root, "change a", "user");
    await writeFile(path.join(root, "b.md"), "bee\nchanged\n");
    await commitAll(root, "change b", "user");

    const forA = await log(root, { path: "a.md" });
    expect(forA.map((commit) => commit.subject)).toEqual(["change a", "system: init study tree"]);
    expect(forA[0]?.sha).toBe(aSha);

    const limited = await log(root, { limit: 2 });
    expect(limited).toHaveLength(2);
    expect(limited.map((commit) => commit.subject)).toEqual(["change b", "change a"]);
  });

  it("diff returns the patch for a commit, optionally scoped to a path", async () => {
    await ensureRepo(root);
    await writeFile(path.join(root, "a.md"), "one\nnew line\n");
    await writeFile(path.join(root, "b.md"), "bee\nnew line\n");
    const sha = requireSha(await commitAll(root, "change both", "tutor"));

    const diffA = await diff(root, sha, "a.md");
    expect(diffA).toContain("+new line");
    expect(diffA).not.toContain("b.md");

    const diffAll = await diff(root, sha);
    expect(diffAll).toContain("a.md");
    expect(diffAll).toContain("b.md");
  });

  it("revert restores content and returns the new sha", async () => {
    await ensureRepo(root);
    await writeFile(path.join(root, "a.md"), "one\nreverted\n");
    const sha = requireSha(await commitAll(root, "change a", "tutor"));

    const newSha = await revert(root, sha, "user");
    expect(newSha).toMatch(/^[0-9a-f]{40}$/);
    expect(newSha).not.toBe(sha);
    expect(await readFile(path.join(root, "a.md"), "utf8")).toBe("one\n");

    const [latest] = await log(root);
    expect(latest).toMatchObject({ sha: newSha, author: "user" });
  });

  it("throws RevertConflictError and leaves a clean tree on conflict", async () => {
    await ensureRepo(root);
    await writeFile(path.join(root, "a.md"), "first\n");
    const firstSha = requireSha(await commitAll(root, "first change", "tutor"));
    await writeFile(path.join(root, "a.md"), "second\n");
    await commitAll(root, "second change", "tutor");

    // Reverting the first change conflicts with the committed later edit.
    await expect(revert(root, firstSha, "user")).rejects.toBeInstanceOf(RevertConflictError);

    expect(await rawGit(root, "status", "--porcelain")).toBe("");
    expect(await readFile(path.join(root, "a.md"), "utf8")).toBe("second\n");
  });

  it("rejects malformed shas without running git", async () => {
    await ensureRepo(root);
    await expect(diff(root, "HEAD; rm -rf /")).rejects.toThrow("Invalid commit sha");
    await expect(revert(root, "not-a-sha", "user")).rejects.toThrow("Invalid commit sha");
    expect(await rawGit(root, "status", "--porcelain")).toBe("");
  });
});
