import { realpathSync, statSync } from "node:fs";
import path from "node:path";

const SET_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export class PathError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PathError";
  }
}

function isInside(parent: string, child: string): boolean {
  return child === parent || child.startsWith(`${parent}${path.sep}`);
}

function deepestExistingPath(candidate: string): string {
  let current = candidate;
  while (true) {
    try {
      statSync(current);
      return current;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new PathError(`No existing ancestor for path: ${candidate}`);
      }
      current = parent;
    }
  }
}

/**
 * Resolve a study-tree-relative path to an absolute path inside `root`.
 *
 * The path must be relative, non-empty, NUL-free, free of `..` segments, and
 * must not target the repository's `.git` or `.cache` directories. Symlinked
 * components are confined by resolving the deepest existing ancestor and
 * requiring it to stay inside the real study root.
 */
export function resolveInRoot(root: string, rel: string): string {
  if (rel === "") {
    throw new PathError("Path must not be empty");
  }
  if (rel.includes("\0")) {
    throw new PathError("Path must not contain NUL bytes");
  }
  if (path.isAbsolute(rel)) {
    throw new PathError(`Absolute paths are not allowed: ${rel}`);
  }
  if (rel.split("/").some((segment) => segment === "..")) {
    throw new PathError(`Path must not contain ".." segments: ${rel}`);
  }

  const rootAbs = path.resolve(root);
  const resolved = path.resolve(root, rel);
  const relNormalized = path.relative(rootAbs, resolved);
  const firstSegment = relNormalized.split(path.sep)[0] ?? "";
  if (firstSegment === ".git" || firstSegment === ".cache") {
    throw new PathError(`Access to ${firstSegment} is not allowed: ${rel}`);
  }

  if (!isInside(rootAbs, resolved)) {
    throw new PathError(`Path escapes study root: ${rel}`);
  }

  let realRoot: string;
  try {
    realRoot = realpathSync(rootAbs);
  } catch (cause) {
    throw new PathError(`Study root is not accessible: ${root}`, { cause });
  }

  const existing = deepestExistingPath(resolved);
  let realExisting: string;
  try {
    realExisting = realpathSync(existing);
  } catch (cause) {
    throw new PathError(`Cannot resolve path: ${rel}`, { cause });
  }
  if (!isInside(realRoot, realExisting)) {
    throw new PathError(`Path escapes study root: ${rel}`);
  }

  return resolved;
}

/**
 * Return the canonical, root-relative POSIX path used for policy checks.
 *
 * Existing path components are resolved through symlinks. Any suffix that does
 * not exist yet is appended unchanged to the deepest existing ancestor.
 */
export function canonicalRel(root: string, rel: string): string {
  const resolved = resolveInRoot(root, rel);
  const realRoot = realpathSync(path.resolve(root));
  const existing = deepestExistingPath(resolved);
  const realExisting = realpathSync(existing);
  const remainder = path.relative(existing, resolved);
  const canonical = path.join(realExisting, remainder);
  return path.relative(realRoot, canonical).split(path.sep).join(path.posix.sep);
}

/**
 * Agents may only write under `<set>/notes/**`, `<set>/log/**`, assets or artifacts, where the
 * set slug is lowercase kebab-case and not the reserved `library` set.
 */
export function isWritableByAgent(relFromRoot: string): boolean {
  if (relFromRoot === "" || relFromRoot.includes("\0") || path.isAbsolute(relFromRoot)) {
    return false;
  }
  const segments = relFromRoot.split("/");
  if (segments.length < 3) {
    return false;
  }
  const [set, kind, ...rest] = segments;
  if (set === undefined || kind === undefined) {
    return false;
  }
  if (set === "library" || !SET_SLUG_PATTERN.test(set)) {
    return false;
  }
  if (!["notes", "log", "assets", "artifacts", "visuals"].includes(kind)) {
    return false;
  }
  return rest.every((segment) => segment !== "" && segment !== "." && segment !== "..");
}
