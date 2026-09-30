import { promises as fs } from "node:fs";
import path from "node:path";
import { resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";

export function parseCompileBookInput(value: unknown): { set: string } {
  if (
    typeof value !== "object" ||
    value === null ||
    !("set" in value) ||
    typeof value.set !== "string" ||
    !isSetSlug(value.set)
  ) {
    throw new Error("invalid set");
  }
  return { set: value.set };
}

/** Cache paths are private to this workspace; reject even dangling symlinks. */
export async function bookCachePath(root: string, rel: string): Promise<string> {
  const realRoot = await fs.realpath(root);
  let current = realRoot;
  for (const segment of rel.split("/")) {
    if (segment === "" || segment === "." || segment === ".." || segment.includes("\0"))
      throw new Error("invalid book path");
    current = path.join(current, segment);
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("book cache must not contain symlinks");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return current;
}

export async function bookPdfPath(root: string, set: string): Promise<string> {
  parseCompileBookInput({ set });
  // A book belongs to a real set, never an arbitrary cache directory.
  await fs.access(resolveInRoot(root, `${set}/PLAN.md`));
  return bookCachePath(root, `${set}/.cache/book/${set}.pdf`);
}
