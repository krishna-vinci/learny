import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { FileLocks } from "./lock";
import { isWritableByAgent, PathError, resolveInRoot } from "./paths";

export type EditErrorCode = "not_found" | "no_match" | "multiple_matches" | "exists" | "forbidden";

export class EditError extends Error {
  readonly code: EditErrorCode;

  constructor(code: EditErrorCode, message: string) {
    super(message);
    this.name = "EditError";
    this.code = code;
  }
}

function isErrnoError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code;
}

function toEditForbidden(error: unknown): unknown {
  if (error instanceof PathError) {
    return new EditError("forbidden", error.message);
  }
  return error;
}

function writableAbsolutePath(root: string, rel: string): string {
  try {
    const abs = resolveInRoot(root, rel);
    if (!isWritableByAgent(rel)) {
      throw new EditError("forbidden", `Path is not writable by agents: ${rel}`);
    }
    return abs;
  } catch (error) {
    throw toEditForbidden(error);
  }
}

async function readUtf8(abs: string, rel: string): Promise<string> {
  try {
    return await readFile(abs, "utf8");
  } catch (error) {
    if (isErrnoError(error, "ENOENT")) {
      throw new EditError("not_found", `File not found: ${rel}`);
    }
    throw error;
  }
}

async function atomicWrite(abs: string, content: string): Promise<void> {
  const dir = path.dirname(abs);
  const tmp = path.join(dir, `.${path.basename(abs)}.tmp-${randomUUID()}`);
  try {
    await writeFile(tmp, content, "utf8");
    await rename(tmp, abs);
  } catch (error) {
    await unlink(tmp).catch(() => undefined);
    throw error;
  }
}

export async function readText(root: string, rel: string): Promise<string> {
  try {
    const abs = resolveInRoot(root, rel);
    return await readUtf8(abs, rel);
  } catch (error) {
    throw toEditForbidden(error);
  }
}

export async function editFile(
  root: string,
  locks: FileLocks,
  holder: string,
  rel: string,
  oldString: string,
  newString: string,
  opts?: { replaceAll?: boolean },
): Promise<{ replacements: number }> {
  if (oldString === newString) {
    throw new Error("oldString and newString must be different");
  }
  if (oldString === "") {
    throw new Error("oldString must not be empty");
  }
  const abs = writableAbsolutePath(root, rel);

  return locks.withLock(rel, holder, async () => {
    const content = await readUtf8(abs, rel);
    const matches = content.split(oldString).length - 1;
    if (matches === 0) {
      throw new EditError("no_match", `oldString not found in ${rel}`);
    }
    if (matches > 1 && opts?.replaceAll !== true) {
      throw new EditError("multiple_matches", `oldString occurs ${matches} times in ${rel}`);
    }

    let updated: string;
    if (opts?.replaceAll === true) {
      updated = content.split(oldString).join(newString);
    } else {
      const index = content.indexOf(oldString);
      updated = content.slice(0, index) + newString + content.slice(index + oldString.length);
    }
    await atomicWrite(abs, updated);
    return { replacements: opts?.replaceAll === true ? matches : 1 };
  });
}

export async function createFile(
  root: string,
  locks: FileLocks,
  holder: string,
  rel: string,
  content: string,
): Promise<void> {
  const abs = writableAbsolutePath(root, rel);

  await locks.withLock(rel, holder, async () => {
    try {
      await lstat(abs);
    } catch (error) {
      if (isErrnoError(error, "ENOENT")) {
        await mkdir(path.dirname(abs), { recursive: true });
        await atomicWrite(abs, content);
        return;
      }
      throw error;
    }
    throw new EditError("exists", `File already exists: ${rel}`);
  });
}
