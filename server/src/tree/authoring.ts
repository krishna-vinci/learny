import { promises as fs } from "node:fs";
import { PlanFrontmatter, parseFrontmatter } from "@studium/shared";
import { createFile, replaceFile } from "./edit.js";
import { commitPaths } from "./git.js";
import type { FileLocks } from "./lock.js";
import { canonicalRel, resolveInRoot } from "./paths.js";
import { isSetSlug } from "./read.js";

interface MutationResult {
  sha: string | null;
  subject: string;
}

export interface CreateSetResult extends MutationResult {
  slug: string;
}

export interface CreateNoteResult extends MutationResult {
  path: string;
}

export function slugify(title: string, max: number): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, max)
    .replace(/-+$/g, "");
  return slug === "" ? "set" : slug;
}

function numberedSlug(base: string, number: number, max: number): string {
  if (number === 1) return base;
  const suffix = `-${number}`;
  const prefix = base.slice(0, Math.max(1, max - suffix.length)).replace(/-+$/g, "") || "set";
  return `${prefix}${suffix}`;
}

// JSON strings are valid YAML double-quoted scalars, so titles like "SVD: intuition" stay one value.
function yamlString(value: string): string {
  return JSON.stringify(value);
}

// Titles are single-line: collapse newlines/tabs so the frontmatter and heading stay intact.
function oneLine(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isAlreadyPresent(error: unknown): boolean {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === "EEXIST";
}

export async function createSet(root: string, input: { title: string; goal?: string }): Promise<CreateSetResult> {
  const title = oneLine(input.title);
  const base = slugify(title, 40);
  let number = base === "library" ? 2 : 1;
  let slug: string;

  while (true) {
    slug = numberedSlug(base, number, 40);
    if (!isSetSlug(slug)) throw new Error(`Invalid generated set slug: ${slug}`);
    try {
      await fs.mkdir(resolveInRoot(root, slug));
      break;
    } catch (error) {
      if (!isAlreadyPresent(error)) throw error;
      number += 1;
    }
  }

  await Promise.all(
    ["notes", "cards", "log"].map((directory) => fs.mkdir(resolveInRoot(root, `${slug}/${directory}`))),
  );
  const goal = input.goal?.trim() || "(not set yet)";
  const plan = `---\ntitle: ${yamlString(title)}\nstatus: active\nlevel: 1\nsources: []\nnext_action: Add a source, then start a chapter\n---\n\n## Goal\n\n${goal}\n`;
  const planPath = `${slug}/PLAN.md`;
  await fs.writeFile(resolveInRoot(root, planPath), plan, "utf8");

  const subject = `user: create set ${title}`;
  const sha = await commitPaths(root, [planPath], subject, "user");
  return { slug, sha, subject };
}

function userNotePath(rel: string): boolean {
  return /^[a-z0-9][a-z0-9-]*\/notes\/[a-z0-9][a-z0-9._-]*\.md$/.test(rel);
}

export async function createNote(
  root: string,
  locks: FileLocks,
  set: string,
  title: string,
): Promise<CreateNoteResult> {
  title = oneLine(title);
  const notesRel = `${set}/notes`;
  return locks.withLock(notesRel, "user", async () => {
    const notesDir = resolveInRoot(root, notesRel);
    // Git does not preserve empty directories, including after restoring an empty set.
    await fs.mkdir(notesDir, { recursive: true });
    const entries = await fs.readdir(notesDir, { withFileTypes: true });
    let maxOrder = 0;
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = /^(\d+)-/.exec(entry.name);
      if (match?.[1] !== undefined) maxOrder = Math.max(maxOrder, Number.parseInt(match[1], 10));
    }

    const order = maxOrder + 1;
    const prefix = String(order).padStart(2, "0");
    const rel = `${notesRel}/${prefix}-${slugify(title, 50)}.md`;
    const content = `---\ntitle: ${yamlString(title)}\norder: ${order}\n---\n\n# ${title}\n\n`;
    await createFile(root, locks, "user", rel, content, { canWrite: userNotePath });

    const subject = `user: create note ${title}`;
    const sha = await commitPaths(root, [rel], subject, "user");
    return { path: rel.slice(set.length + 1), sha, subject };
  });
}

function noteTitle(content: string, rel: string): string {
  try {
    const title = parseFrontmatter(content).frontmatter.title;
    if (typeof title === "string" && title.trim() !== "") return title.trim();
  } catch {
    // A hand-edited note may have invalid frontmatter; use its path in the commit subject.
  }
  const separator = rel.indexOf("/");
  return separator === -1 ? rel : rel.slice(separator + 1);
}

export async function writeNoteAsUser(
  root: string,
  locks: FileLocks,
  rel: string,
  content: string,
  previous: string,
): Promise<MutationResult> {
  await replaceFile(root, locks, "user", rel, content, previous, { canWrite: userNotePath });
  const subject = `user: edit ${noteTitle(content, rel)}`;
  const sha = await commitPaths(root, [rel], subject, "user");
  return { sha, subject };
}

export async function writePlanAsUser(
  root: string,
  locks: FileLocks,
  rel: string,
  content: string,
  previous: string,
): Promise<MutationResult> {
  if (!/^[a-z0-9][a-z0-9-]*\/PLAN\.md$/.test(rel) || canonicalRel(root, rel) !== rel)
    throw new Error("Invalid plan path");
  try {
    if (!/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.test(content))
      throw new Error("A complete frontmatter block is required");
    PlanFrontmatter.parse(parseFrontmatter(content).frontmatter);
  } catch (error) {
    throw new Error(`Invalid PLAN.md frontmatter: ${error instanceof Error ? error.message : String(error)}`);
  }
  await replaceFile(root, locks, "user", rel, content, previous, { canWrite: (candidate) => candidate === rel });
  const subject = "user: edit plan";
  return { sha: await commitPaths(root, [rel], subject, "user"), subject };
}
