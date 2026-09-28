const PAGE_MARKER = /^<!-- p:\d+ -->$/;

/** Deterministic markdown cleanup shared by every text extractor. */
export function cleanMarkdown(markdown: string): string {
  let text = markdown.replace(/\r\n?/g, "\n");
  text = deHyphenate(text);
  text = stripRepeatedHeadersFooters(text);
  text = normalizeHeadings(text);
  text = text
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n");
  text = text.replace(/\n{3,}/g, "\n\n");
  return `${text.replace(/^\n+/, "").replace(/\n+$/, "")}\n`;
}

/**
 * A PDF text layer quality check. Poor results trigger a MinerU fallback (or a
 * `parse_warning` when MinerU is not configured).
 */
export function pdfQuality(pages: string[]): { ok: boolean; reason: string | null } {
  if (pages.length === 0) return { ok: false, reason: "no pages" };
  let contentChars = 0;
  let replacementChars = 0;
  for (const page of pages) {
    contentChars += page.replace(/\s/g, "").length;
    replacementChars += (page.match(/\uFFFD/g) ?? []).length;
  }
  const perPage = contentChars / pages.length;
  if (perPage < 200) {
    return { ok: false, reason: `low text density (${Math.round(perPage)} chars/page)` };
  }
  const ratio = contentChars === 0 ? 1 : replacementChars / contentChars;
  if (ratio > 0.05) {
    return { ok: false, reason: `too many replacement characters (${(ratio * 100).toFixed(1)}%)` };
  }
  return { ok: true, reason: null };
}

// Join words broken across a line ("exam-\nple" -> "example").
function deHyphenate(text: string): string {
  return text.replace(/([A-Za-z])-\n([a-z])/g, "$1$2");
}

// Drop lines that repeat on at least half of the pages: running headers/footers.
function stripRepeatedHeadersFooters(text: string): string {
  const lines = text.split("\n");
  const pages: string[][] = [[]];
  for (const line of lines) {
    if (PAGE_MARKER.test(line)) {
      pages.push([]);
      continue;
    }
    pages[pages.length - 1]?.push(line);
  }
  if (pages.length < 2) return text;

  const pageCounts = new Map<string, number>();
  for (const page of pages) {
    const seen = new Set<string>();
    for (const line of page) {
      const key = line.trim();
      if (key === "" || key.startsWith("#") || key.startsWith("<!--") || key.length > 200) continue;
      seen.add(key);
    }
    for (const key of seen) pageCounts.set(key, (pageCounts.get(key) ?? 0) + 1);
  }

  const threshold = Math.max(2, Math.ceil(pages.length * 0.5));
  const repeated = new Set<string>();
  for (const [key, count] of pageCounts) {
    if (count >= threshold) repeated.add(key);
  }
  if (repeated.size === 0) return text;

  return lines.filter((line) => PAGE_MARKER.test(line) || !repeated.has(line.trim())).join("\n");
}

// Add the missing space in "#Heading", clamp the level to 6 and drop trailing "#".
// Lines inside fenced code blocks are left untouched.
function normalizeHeadings(text: string): string {
  let inFence = false;
  return text
    .split("\n")
    .map((line) => {
      if (/^(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      const match = /^(#{1,})\s*(.*?)\s*#*\s*$/.exec(line);
      if (match === null) return line;
      const level = Math.min(match[1]?.length ?? 1, 6);
      const title = match[2] ?? "";
      return title === "" ? "#".repeat(level) : `${"#".repeat(level)} ${title}`;
    })
    .join("\n");
}
