import { createHash, randomUUID } from "node:crypto";
import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { commitPaths } from "./git.js";
import { FileLocks } from "./lock.js";
import { resolveInRoot } from "./paths.js";

const DEFAULT_SKILLS = fileURLToPath(new URL("../../../skills/", import.meta.url));
const locks = new FileLocks();

function sha256(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

async function* defaultFiles(directory: string): AsyncGenerator<string> {
  const entries = await fs.readdir(path.join(DEFAULT_SKILLS, directory), { withFileTypes: true });
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) yield* defaultFiles(file);
    else if (entry.isFile()) yield file;
  }
}

async function atomicWrite(root: string, rel: string, content: Buffer): Promise<void> {
  const abs = resolveInRoot(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  const temporary = path.posix.join(path.posix.dirname(rel), `.${path.posix.basename(rel)}.tmp-${randomUUID()}`);
  const tmp = resolveInRoot(root, temporary);
  try {
    await fs.writeFile(tmp, content, { flag: "wx" });
    await fs.rename(tmp, resolveInRoot(root, rel));
  } finally {
    await fs.unlink(tmp).catch(() => undefined);
  }
}

/** Sync at boot, before workspace writers start. Only known defaults may be replaced. */
export async function syncDefaultSkills(root: string): Promise<void> {
  const realRoot = await fs.realpath(root);
  await locks.withLock(realRoot, "system", async () => {
    const history: Record<string, string[]> = JSON.parse(
      await fs.readFile(path.join(DEFAULT_SKILLS, ".defaults-history.json"), "utf8"),
    );
    const updated: string[] = [];
    const skills = await fs.readdir(DEFAULT_SKILLS, { withFileTypes: true });
    for (const skill of skills) {
      if (!skill.isDirectory()) continue;
      for await (const file of defaultFiles(skill.name)) {
        const rel = `_global/skills/${file}`;
        const next = await fs.readFile(path.join(DEFAULT_SKILLS, file));
        const abs = resolveInRoot(root, rel);
        let current: Buffer | null = null;
        try {
          const stat = await fs.lstat(abs);
          if (!stat.isFile()) {
            console.log(`studium: kept user-edited skill ${rel}`);
            continue;
          }
          current = await fs.readFile(abs);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }

        if (current !== null) {
          if (current.equals(next)) continue;
          if (!history[file]?.includes(sha256(current))) {
            console.log(`studium: kept user-edited skill ${rel}`);
            continue;
          }
        }
        await atomicWrite(root, rel, next);
        updated.push(rel);
      }
    }

    // Fresh trees are committed by ensureRepo after the whole skeleton is initialized.
    if (updated.length > 0 && existsSync(path.join(root, ".git"))) {
      await commitPaths(root, updated, "system: update default skills", "system");
    }
  });
}
