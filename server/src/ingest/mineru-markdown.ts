import { createHash } from "node:crypto";
import { parseHTML } from "linkedom";
import type { SourceFigure } from "./figures.js";
import { MAX_IMAGE_BYTES, MIN_IMAGE_PIXELS, sniffImage } from "./image-bytes.js";
import { figureLicense, licenseUrl } from "./image-license.js";

export interface EmbeddedFigures {
  figures: SourceFigure[];
  files: Map<string, Uint8Array>;
}

/** Stage embedded originals. Publication remains with ingest/refresh and their path guards. */
export function processMineruMarkdown(
  markdown: string,
  source: { url: string | null; title: string | null; authors: string[]; license?: string },
): { markdown: string; embeddedFigures: EmbeddedFigures } {
  const embeddedFigures: EmbeddedFigures = { figures: [], files: new Map() };
  const sourcePage = source.url ?? "source.md";
  const license = source.license ?? figureLicense(markdown.slice(0, 20_000));
  let section = "";
  const lines = markdown.split("\n");
  for (let index = 0; index < lines.length; index++) {
    let line = lines[index] ?? "";
    const heading = /^#{1,6}\s+(.+)/.exec(line);
    if (heading) section = heading[1] ?? "";
    const next = lines.slice(index + 1).find((value) => value.trim());
    const previous = lines
      .slice(0, index)
      .reverse()
      .find((value) => value.trim());
    const caption =
      [next, previous].find((value) => /^\s*(?:\*{0,2})?(?:fig(?:ure)?\.?|图)\s*\d/i.test(value ?? ""))?.trim() ?? "";
    const extract = (uri: string, alt = "") => {
      try {
        const match = /^data:(image\/(?:jpeg|png|gif|webp));base64,([A-Za-z0-9+/=]+)$/.exec(uri);
        if (!match || (match[2]?.length ?? 0) > (MAX_IMAGE_BYTES * 4) / 3 + 4) return null;
        const bytes = Buffer.from(match[2] ?? "", "base64");
        const info = sniffImage(bytes);
        if (
          info.mime !== match[1] ||
          Math.max(info.width, info.height) < MIN_IMAGE_PIXELS ||
          info.width > 6000 ||
          info.height > 6000
        )
          return null;
        const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
        const path = `figures/${hash}.${info.ext}`;
        embeddedFigures.files.set(path, bytes);
        if (!embeddedFigures.figures.some((figure) => figure.path === path))
          embeddedFigures.figures.push({
            path,
            url: `${sourcePage}#figure-${hash}`,
            sourcePage,
            alt: alt || caption,
            caption: caption || alt,
            section,
            license,
            licenseUrl: licenseUrl(license),
            width: info.width,
            height: info.height,
            creator: source.authors.join(", ") || source.title || "Source PDF",
            credit: `${source.authors.join(", ") || source.title || "Source PDF"}, ${sourcePage} (${license ?? "licence unknown"})`,
          });
        // parsed files may later live in parsed/; publication adjusts those links.
        return path;
      } catch {
        return null;
      }
    };
    line = line.replace(/!\[([^\]]*)\]\((data:image\/[^)\s]+)\)/g, (_match, alt: string, uri: string) => {
      const path = extract(uri, alt);
      return path ? `![${alt || caption}](${path})` : "";
    });
    line = line.replace(/<img\b[^>]*\bsrc\s*=\s*["'](data:image\/[^"']+)["'][^>]*>/gi, (match, uri: string) => {
      const { document } = parseHTML(match);
      const alt = document.querySelector("img")?.getAttribute("alt") ?? "";
      const path = extract(uri, alt);
      return path ? `![${alt || caption}](${path})` : "";
    });
    lines[index] = line;
  }
  let text = lines.join("\n").replace(/<table\b[^>]*>[\s\S]*?<\/table>/gi, (table) => {
    const { document } = parseHTML(table);
    const element = document.querySelector("table");
    if (!element || element.querySelector("[rowspan], [colspan], table")) return table;
    const rows = [...element.querySelectorAll("tr")].map((row) =>
      [...row.querySelectorAll("th, td")].map((cell) => {
        // Do not run TeX through Turndown, which escapes backslashes and dollar signs.
        return (cell.innerHTML ?? "")
          .replace(/<br\s*\/?\s*>/gi, "STUDIUMCELLBREAK")
          .replace(/<[^>]*>/g, "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&nbsp;/g, " ")
          .trim()
          .replace(/\|/g, "\\|")
          .replace(/\n+/g, " ")
          .replace(/STUDIUMCELLBREAK/g, "<br>");
      }),
    );
    if (!rows.length || rows.some((row) => !row.length)) return table;
    const width = Math.max(...rows.map((row) => row.length));
    const render = (row: string[]) => `| ${Array.from({ length: width }, (_, i) => row[i] ?? "").join(" | ")} |`;
    const first = rows.shift() ?? [];
    const caption = element.querySelector("caption")?.textContent?.trim();
    return `\n\n${caption ? `${caption}\n\n` : ""}${[render(first), render(Array(width).fill("---")), ...rows.map(render)].join("\n")}\n\n`;
  });
  let fence: string | undefined;
  let math = false;
  let html = false;
  text = text
    .split("\n")
    .filter((line) => {
      const trimmed = line.trim();
      const marker = /^(`{3,}|~{3,})/.exec(trimmed)?.[1];
      if (marker) {
        if (!fence) fence = marker;
        else if (marker[0] === fence[0] && marker.length >= fence.length) fence = undefined;
        return true;
      }
      if (fence) return true;
      if (trimmed.startsWith("$$")) {
        if ((trimmed.match(/\$\$/g) ?? []).length % 2) math = !math;
        return true;
      }
      if (/<table\b/i.test(line)) html = true;
      if (/<\/table>/i.test(line)) {
        html = false;
        return true;
      }
      if (math || html || /(?<!\\)\$[^$]+(?<!\\)\$/.test(line)) return true;
      if (!trimmed || /^(?:[-*_]\s*){3,}$/.test(trimmed) || /^\|/.test(trimmed) || /^<!--/.test(trimmed)) return true;
      const compact = trimmed.replace(/\s/g, "");
      const meaningful = (compact.match(/[\p{L}\p{N}]/gu) ?? []).length;
      return compact.length < 5 || meaningful / compact.length >= 0.2 || /[\p{L}\p{N}]{2,}/u.test(compact);
    })
    .join("\n");
  return { markdown: text, embeddedFigures };
}

/** Images are source-relative before splitting, file-relative afterwards. */
export function parsedFigureLinks(content: string, partPath: string): string {
  return partPath.startsWith("parsed/") ? content.replace(/\]\(figures\//g, "](../figures/") : content;
}
