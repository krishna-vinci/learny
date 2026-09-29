import { promises as fs } from "node:fs";
import path from "node:path";
import { USERNAME_PATTERN } from "../accounts/users.js";

export interface MigrateLegacyTreeDeps {
  dataDir: string;
  legacyRoot: string;
  adminUsername: string;
}

export async function migrateLegacyTree(deps: MigrateLegacyTreeDeps): Promise<{ moved: boolean }> {
  if (!USERNAME_PATTERN.test(deps.adminUsername)) {
    throw new Error(`invalid admin username for legacy study tree migration: ${deps.adminUsername}`);
  }
  const usersDir = path.join(deps.dataDir, "users");
  const target = path.join(usersDir, deps.adminUsername);
  if (await pathExists(target)) return { moved: false };
  if (!(await pathExists(path.join(deps.legacyRoot, "_global", "studium.yaml")))) return { moved: false };

  await fs.mkdir(usersDir, { recursive: true });
  try {
    await fs.rename(deps.legacyRoot, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EXDEV") {
      throw new Error(
        `legacy study tree is on a different filesystem than ${usersDir}; move it manually before starting Studium`,
        { cause: error },
      );
    }
    throw error;
  }
  console.log(`migrated legacy study tree ${deps.legacyRoot} to ${target}`);
  return { moved: true };
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}
