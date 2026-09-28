import { promises as fs } from "node:fs";
import path from "node:path";
import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { parse as parseYaml } from "yaml";
import { resolveInRoot } from "../../tree/paths.js";

const SKILL_NAME_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

interface ToolDetails {
  isError: boolean;
  summary: string;
  skill?: string;
  file?: string;
}

export interface SkillSummary {
  name: string;
  description: string;
}

function result(summary: string, text: string, details: Omit<ToolDetails, "isError" | "summary"> = {}) {
  return {
    content: [{ type: "text" as const, text }],
    details: { ...details, isError: false as boolean, summary } satisfies ToolDetails,
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    details: { isError: true as boolean, summary: message } satisfies ToolDetails,
  };
}

function allowedName(name: string, allowed: readonly string[]): string {
  if (!SKILL_NAME_PATTERN.test(name) || !allowed.includes(name)) {
    throw new Error(`Skill is not available: ${name}`);
  }
  return name;
}

function skillRoot(root: string, name: string): string {
  return resolveInRoot(root, path.posix.join("_global/skills", name));
}

async function fileOrNull(abs: string): Promise<string | null> {
  try {
    return await fs.readFile(abs, "utf8");
  } catch {
    return null;
  }
}

function frontmatter(markdown: string): SkillSummary {
  const match = /^---\n([\s\S]*?)\n---\n?/.exec(markdown);
  if (match === null) throw new Error("SKILL.md has no frontmatter");
  let parsed: unknown;
  try {
    parsed = parseYaml(match[1] ?? "");
  } catch {
    throw new Error("SKILL.md frontmatter is invalid YAML");
  }
  if (typeof parsed !== "object" || parsed === null) throw new Error("SKILL.md frontmatter is invalid");
  const record = parsed as Record<string, unknown>;
  if (typeof record.name !== "string" || typeof record.description !== "string") {
    throw new Error("SKILL.md frontmatter requires name and description strings");
  }
  return { name: record.name, description: record.description };
}

async function referenceFiles(root: string, name: string): Promise<string[]> {
  const references = path.posix.join("_global/skills", name, "references");
  try {
    await fs.access(resolveInRoot(root, references));
  } catch {
    return [];
  }
  const files: string[] = [];
  async function visit(relDir: string) {
    const entries = await fs.readdir(resolveInRoot(root, relDir), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const rel = path.posix.join(relDir, entry.name);
      resolveInRoot(root, rel);
      if (entry.isDirectory()) await visit(rel);
      else files.push(path.posix.relative(references, rel));
    }
  }
  await visit(references);
  return files.sort((a, b) => a.localeCompare(b));
}

export async function listSkills(root: string, allowed: readonly string[]): Promise<SkillSummary[]> {
  const summaries: SkillSummary[] = [];
  for (const name of allowed) {
    allowedName(name, allowed);
    const markdown = await fileOrNull(path.join(skillRoot(root, name), "SKILL.md"));
    if (markdown === null) continue;
    summaries.push(frontmatter(markdown));
  }
  return summaries;
}

export function skillTools(root: string, allowed: string[]): ToolDefinition[] {
  const loadSkill = defineTool({
    name: "load_skill",
    label: "Load skill",
    description: "Load an allowed Agent Skill and list its reference files.",
    parameters: Type.Object({ name: Type.String({ minLength: 1 }) }),
    async execute(_toolCallId, params) {
      try {
        const name = allowedName(params.name, allowed);
        const markdown = await fs.readFile(
          resolveInRoot(root, path.posix.join("_global/skills", name, "SKILL.md")),
          "utf8",
        );
        const references = await referenceFiles(root, name);
        const listing =
          references.length === 0 ? "No reference files." : references.map((file) => `- ${file}`).join("\n");
        return result(`loaded skill ${name}`, `${markdown}\n\n## Reference files\n\n${listing}\n`, { skill: name });
      } catch (error) {
        return errorResult(error);
      }
    },
  });

  const loadSkillReference = defineTool({
    name: "load_skill_reference",
    label: "Load skill reference",
    description: "Read one file from an allowed skill's references directory.",
    parameters: Type.Object({ name: Type.String({ minLength: 1 }), file: Type.String({ minLength: 1 }) }),
    async execute(_toolCallId, params) {
      try {
        const name = allowedName(params.name, allowed);
        const reference = params.file.replace(/\\/g, "/");
        if (reference.includes("..") || path.posix.isAbsolute(reference) || reference.startsWith("/")) {
          throw new Error("Reference file must be relative to the skill's references directory");
        }
        const rel = path.posix.join("_global/skills", name, "references", reference);
        resolveInRoot(root, rel);
        const text = await fs.readFile(resolveInRoot(root, rel), "utf8");
        return result(`loaded ${name} reference ${reference}`, text, { skill: name, file: reference });
      } catch (error) {
        return errorResult(error);
      }
    },
  });

  return [loadSkill, loadSkillReference];
}
