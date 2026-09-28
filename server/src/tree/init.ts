import { existsSync, promises as fs } from "node:fs";
import path from "node:path";
import { StudiumYaml } from "@studium/shared";
import { parse as parseYaml } from "yaml";
import { trackedFiles } from "./git.js";

export const SUPPORTED_SCHEMA_VERSION = 1;

const STUDIUM_YAML = `schema_version: ${SUPPORTED_SCHEMA_VERSION}\n`;

const CONFIG_YAML = `# Role -> model map. Model strings are "<provider>/<model-id>".\nmodels:\n  default: faux/echo\n  roles: {}\n`;

const PROFILE_MD = `# Learner profile\n- Goal:\n- Background:\n- Pace:\n- Style:\n`;

// Keep in step with examples/sample-set/.gitignore and docs/STUDY_TREE.md.
export const REQUIRED_IGNORES = ["**/original.*", "*/chats/", ".cache/", ".*.tmp-*"];

async function readFileOrNull(abs: string): Promise<string | null> {
  try {
    return await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}

export async function initStudyTree(root: string): Promise<{ created: boolean }> {
  await fs.mkdir(root, { recursive: true });

  const globalDir = path.join(root, "_global");
  const marker = path.join(globalDir, "studium.yaml");

  const existing = await readFileOrNull(marker);
  if (existing !== null) {
    let raw: unknown = null;
    try {
      raw = parseYaml(existing);
    } catch {
      raw = null;
    }
    const parsed = StudiumYaml.safeParse(raw);
    if (parsed.success && parsed.data.schema_version > SUPPORTED_SCHEMA_VERSION) {
      throw new Error(
        `study tree schema_version ${parsed.data.schema_version} is newer than this app supports (${SUPPORTED_SCHEMA_VERSION})`,
      );
    }
    await ensureIgnores(root);
    return { created: false };
  }

  await fs.mkdir(globalDir, { recursive: true });
  await fs.writeFile(marker, STUDIUM_YAML);
  await fs.writeFile(path.join(globalDir, "config.yaml"), CONFIG_YAML);
  await fs.writeFile(path.join(globalDir, "profile.md"), PROFILE_MD);
  await ensureIgnores(root);

  return { created: true };
}

/**
 * Repair the root .gitignore so chats, source originals, caches, and
 * interrupted atomic-write temp files never enter git. Missing patterns are
 * appended; existing user lines are never removed or rewritten.
 */
export async function ensureIgnores(root: string): Promise<void> {
  const ignoreFile = path.join(root, ".gitignore");
  let existing: string | null = null;
  try {
    existing = await fs.readFile(ignoreFile, "utf8");
  } catch {
    existing = null;
  }

  const lines = existing?.split("\n") ?? [];
  const missing = REQUIRED_IGNORES.filter((pattern) => !lines.includes(pattern));
  if (missing.length === 0) {
    return;
  }

  if (existing === null) {
    await fs.writeFile(ignoreFile, `${REQUIRED_IGNORES.join("\n")}\n`, "utf8");
  } else {
    const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
    await fs.writeFile(ignoreFile, `${existing}${separator}${missing.join("\n")}\n`, "utf8");
  }

  // Repairing the ignore file does not rewrite history. If tracked files
  // already match a repaired pattern, surface that instead of hiding it.
  if (!existsSync(path.join(root, ".git"))) {
    return;
  }
  for (const pattern of missing) {
    const tracked = await trackedFiles(root, pattern).catch(() => []);
    if (tracked.length > 0) {
      console.warn(
        `studium: repaired .gitignore pattern ${pattern}, but ${tracked.length} tracked file(s) already match it in git history; they were not removed`,
      );
    }
  }
}
