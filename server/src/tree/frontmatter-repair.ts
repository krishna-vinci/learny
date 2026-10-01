import { FrontmatterError, parseFrontmatter } from "@studium/shared";

const FRONTMATTER = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const PLAIN_PAIR = /^([A-Za-z_][\w-]*):[ \t]+(.+)$/;

/** Quote a top-level plain scalar that YAML would misread (`title: A: B`, `title: C# basics`). */
function quoteLine(line: string): string {
  const match = PLAIN_PAIR.exec(line);
  if (!match) return line;
  const [, key, value = ""] = match;
  const trimmed = value.trim();
  if (/^["'[{|>&*!%@`]/.test(trimmed)) return line;
  if (!/:\s|:$|\s#/.test(trimmed)) return line;
  return `${key}: ${JSON.stringify(trimmed)}`;
}

/**
 * Agents often write `title: Before Hyderabad: Deccan and Golconda` unquoted, which is invalid
 * YAML and breaks every later reader. For Markdown writes, repair such lines; if the frontmatter
 * is still invalid, throw so the agent's tool call fails with a fixable message. The learner's
 * own saves (`strict` false) are kept exactly as written.
 */
export function repairFrontmatter(rel: string, content: string, strict = true): string {
  if (!strict || !rel.endsWith(".md")) return content;
  try {
    parseFrontmatter(content);
    return content;
  } catch (error) {
    if (!(error instanceof FrontmatterError)) throw error;
  }
  const match = FRONTMATTER.exec(content);
  if (!match) return content;
  const raw = match[1] ?? "";
  const repaired = raw.split(/\r?\n/).map(quoteLine).join("\n");
  const fixed = content.replace(raw, () => repaired);
  try {
    parseFrontmatter(fixed);
    return fixed;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`${reason}. Quote values that contain ": " or " #", e.g. title: "A: B".`);
  }
}
