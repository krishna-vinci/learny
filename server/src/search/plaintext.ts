// Markdown source kept in the search index is reduced to plain text so snippets do
// not leak diagram source, code, frontmatter or markup. Titles are stored separately.

const FRONTMATTER = /^\uFEFF?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;
// An opening ``` or ~~~ fence: optional indent, three or more markers, optional info string.
const FENCE_LINE = /^[ \t]{0,3}(`{3,}|~{3,})(.*)$/;
const FOOTNOTE_DEFINITION = /^[ \t]*\[\^[^\]]+\]:/;
const FOOTNOTE_REFERENCE = /\[\^[^\]]*\]/g;
// Directive fences (`:::definition`, `:::`) and attributes such as `{title="…"}`.
const DIRECTIVE_FENCE = /^[ \t]*:::+.*$/gm;
const DIRECTIVE_ATTRIBUTE = /\{[^{}\n]*=["'][^"'\n]*["'][^{}\n]*\}/g;
const HEADING = /^[ \t]{0,3}#{1,6}[ \t]+/gm;
const LIST_MARKER = /^[ \t]*([-*+]|\d{1,9}[.)])[ \t]+/gm;
const LINK_DEFINITION = /^[ \t]*\[[^\]]+\]:[ \t]*\S.*$/gm;
const IMAGE = /!\[([^\]]*)\]\([^)\s]*(?:[ \t]+"[^"]*")?\)/g;
const LINK = /\[([^\]]+)\]\([^)\s]*(?:[ \t]+"[^"]*")?\)/g;
const REFERENCE_LINK = /\[([^\]]+)\]\[[^\]]*\]/g;
const EMPHASIS_STRONG = /\*\*([^*]+)\*\*/g;
const EMPHASIS_STRONG_UNDERSCORE = /__([^_]+)__/g;
const EMPHASIS_EM = /(?<![A-Za-z0-9_])\*([^*\n]+)\*(?![A-Za-z0-9_])/g;
const EMPHASIS_EM_UNDERSCORE = /(?<![A-Za-z0-9_])_([^_\n]+)_(?![A-Za-z0-9_])/g;

/** Drops fenced code blocks (``` and ~~~), keeping nothing inside the fence. */
function dropFences(text: string): string {
  const kept: string[] = [];
  let open: "`" | "~" | null = null;
  for (const line of text.split("\n")) {
    const fence = FENCE_LINE.exec(line);
    if (open === null) {
      if (fence !== null) {
        open = (fence[1] ?? "").startsWith("`") ? "`" : "~";
        continue;
      }
      kept.push(line);
      continue;
    }
    // Only a bare closing marker with the same character ends the block.
    if (fence !== null && (fence[1] ?? "").startsWith(open) && (fence[2] ?? "").trim() === "") open = null;
  }
  return kept.join("\n");
}

/** Drops `[^id]: …` definitions and the indented lines that continue them. */
function dropFootnoteDefinitions(text: string): string {
  const lines = text.split("\n");
  const kept: string[] = [];
  for (let index = 0; index < lines.length; index++) {
    const line = lines[index] ?? "";
    if (FOOTNOTE_DEFINITION.test(line)) {
      while (index + 1 < lines.length && /^(?:[ \t]{2,}|\t)/.test(lines[index + 1] ?? "")) index++;
      continue;
    }
    kept.push(line);
  }
  return kept.join("\n");
}

/**
 * Plain searchable text for a Markdown body. Maths (`$…$`, `$$…$$`) is kept as-is so
 * its words stay searchable; everything else is reduced to text separated by single
 * runs of whitespace.
 */
export function plaintext(raw: string): string {
  let text = raw.replace(FRONTMATTER, "");
  text = dropFences(text);
  text = dropFootnoteDefinitions(text);
  // HTML comments, e.g. parser page markers like `<!-- p:4 -->`, are never content.
  text = text.replace(/<!--[\s\S]*?-->/g, " ");
  text = text
    .replace(FOOTNOTE_REFERENCE, "")
    .replace(DIRECTIVE_FENCE, "")
    .replace(DIRECTIVE_ATTRIBUTE, "")
    .replace(HEADING, "")
    .replace(LIST_MARKER, "")
    .replace(LINK_DEFINITION, "")
    .replace(IMAGE, "$1")
    .replace(LINK, "$1")
    .replace(REFERENCE_LINK, "$1")
    .replace(EMPHASIS_STRONG, "$1")
    .replace(EMPHASIS_STRONG_UNDERSCORE, "$1")
    .replace(EMPHASIS_EM, "$1")
    .replace(EMPHASIS_EM_UNDERSCORE, "$1")
    .replace(/\*\*/g, "");
  return text.replace(/\s+/g, " ").trim();
}
