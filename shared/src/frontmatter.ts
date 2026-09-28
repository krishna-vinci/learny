import { parse as parseYaml } from "yaml";

export class FrontmatterError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FrontmatterError";
  }
}

// A leading `---\n<yaml>\n---\n` block. Anchored at the start of the file.
const FRONTMATTER_BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

export function parseFrontmatter(text: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = FRONTMATTER_BLOCK.exec(text);
  if (!match) {
    return { frontmatter: {}, body: text };
  }

  const body = text.slice(match[0].length);
  const raw = match[1] ?? "";

  let parsed: unknown;
  try {
    parsed = parseYaml(raw);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    throw new FrontmatterError(`invalid frontmatter YAML: ${reason}`);
  }

  if (parsed === null || parsed === undefined) {
    return { frontmatter: {}, body };
  }
  if (typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new FrontmatterError("frontmatter must be a YAML mapping");
  }

  return { frontmatter: parsed as Record<string, unknown>, body };
}
