import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import type { FileView, NoteSummary, SetSummary } from "@studium/shared";
import { NoteFrontmatter, PlanFrontmatter, parseFrontmatter } from "@studium/shared";
import { resolveInRoot } from "./paths.js";

export function isSetSlug(name: string): boolean {
  return /^[a-z0-9][a-z0-9-]*$/.test(name) && name !== "library";
}

// Reads frontmatter without ever throwing: a user-edited file must not break listing.
function safeFrontmatter(text: string): Record<string, unknown> {
  try {
    return parseFrontmatter(text).frontmatter;
  } catch {
    return {};
  }
}

// Validate one field on its own so a single bad value only loses that field.
function field<T>(
  schema: { safeParse: (value: unknown) => { success: true; data: T } | { success: false } },
  value: unknown,
): T | undefined {
  const parsed = schema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}

export async function listSets(root: string): Promise<SetSummary[]> {
  let entries: Dirent[];
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return [];
  }

  const sets: SetSummary[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    if (slug.startsWith("_") || slug.startsWith(".") || !isSetSlug(slug)) continue;

    let plan: string;
    try {
      plan = await fs.readFile(path.join(root, slug, "PLAN.md"), "utf8");
    } catch {
      continue; // no PLAN.md → not a set
    }

    const frontmatter = safeFrontmatter(plan);
    const fields = PlanFrontmatter.shape;
    sets.push({
      slug,
      title: field(fields.title, frontmatter.title) ?? slug,
      status: field(fields.status, frontmatter.status) ?? "draft",
      level: field(fields.level, frontmatter.level) ?? null,
      deadline: field(fields.deadline, frontmatter.deadline) ?? null,
      nextAction: field(fields.next_action, frontmatter.next_action) ?? null,
    });
  }

  sets.sort((a, b) => a.slug.localeCompare(b.slug));
  return sets;
}

export async function listNotes(root: string, set: string): Promise<NoteSummary[]> {
  const dir = path.join(root, set, "notes");
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const notes: NoteSummary[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    let text: string;
    try {
      text = await fs.readFile(path.join(dir, entry.name), "utf8");
    } catch {
      continue;
    }

    const frontmatter = safeFrontmatter(text);
    const fields = NoteFrontmatter.shape;
    notes.push({
      path: `notes/${entry.name}`,
      title: field(fields.title, frontmatter.title) ?? entry.name.replace(/\.md$/, ""),
      order: field(fields.order, frontmatter.order) ?? null,
      status: field(fields.status, frontmatter.status) ?? null,
    });
  }

  notes.sort((a, b) => {
    const ao = a.order ?? Number.POSITIVE_INFINITY;
    const bo = b.order ?? Number.POSITIVE_INFINITY;
    if (ao !== bo) return ao - bo;
    return a.path.localeCompare(b.path);
  });
  return notes;
}

export async function readSetFile(root: string, set: string, rel: string): Promise<FileView | null> {
  const abs = resolveInRoot(root, `${set}/${rel}`);

  let text: string;
  try {
    text = await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }

  try {
    const { frontmatter, body } = parseFrontmatter(text);
    return { path: rel, frontmatter, body, raw: text };
  } catch {
    // Broken frontmatter in a user file: still show the raw text rather than fail.
    return { path: rel, frontmatter: {}, body: text, raw: text };
  }
}
