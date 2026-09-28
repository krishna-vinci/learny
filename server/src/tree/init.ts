import { promises as fs } from "node:fs";
import path from "node:path";
import { StudiumYaml } from "@studium/shared";
import { parse as parseYaml } from "yaml";

export const SUPPORTED_SCHEMA_VERSION = 1;

const STUDIUM_YAML = `schema_version: ${SUPPORTED_SCHEMA_VERSION}\n`;

const CONFIG_YAML = `# Role -> model map. Model strings are "<provider>/<model-id>".\nmodels:\n  default: faux/echo\n  roles: {}\n`;

const PROFILE_MD = `# Learner profile\n- Goal:\n- Background:\n- Pace:\n- Style:\n`;

// Keep in step with examples/sample-set/.gitignore and docs/STUDY_TREE.md.
const GITIGNORE = `**/original.*\n*/chats/\n.cache/\n`;

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
    return { created: false };
  }

  await fs.mkdir(globalDir, { recursive: true });
  await fs.writeFile(marker, STUDIUM_YAML);
  await fs.writeFile(path.join(globalDir, "config.yaml"), CONFIG_YAML);
  await fs.writeFile(path.join(globalDir, "profile.md"), PROFILE_MD);
  await fs.writeFile(path.join(root, ".gitignore"), GITIGNORE);

  return { created: true };
}
