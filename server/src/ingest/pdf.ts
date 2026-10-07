import { getDocumentProxy, getMeta } from "unpdf";
import { cleanMarkdown, pdfQuality } from "./clean.js";
import { mineruParse } from "./mineru.js";
import { processMineruMarkdown } from "./mineru-markdown.js";
import { type Extracted, UnsupportedInputError } from "./types.js";

/** Reject a PDF whose declared page count exceeds this before parsing pages. */
export const PDF_MAX_PAGES = 2000;
/** Stop collecting page text once this many characters have been extracted. */
export const PDF_MAX_TEXT_CHARS = 20_000_000;

export interface PdfExtractOptions {
  url?: string | null;
  filename?: string | null;
  mineruUrl?: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
  onWarning?: (message: string) => void;
  license?: string;
}

/**
 * Extract text from a PDF with page anchors (`<!-- p:N -->`). When
 * MinerU is configured, every PDF is re-parsed there;
 * otherwise the basic text is kept with a `parse_warning`.
 */
export async function extractPdf(bytes: Uint8Array, options: PdfExtractOptions = {}): Promise<Extracted> {
  // pdf.js takes ownership of (and may detach) the buffer it is given, so hand it
  // a copy and keep `bytes` intact for the MinerU fallback and the original file.
  const document = await getDocumentProxy(bytes.slice());
  let info: Record<string, unknown> = {};
  const pages: string[] = [];
  let totalPages = 0;
  let truncated = false;
  try {
    totalPages = document.numPages;
    if (totalPages > PDF_MAX_PAGES) {
      throw new UnsupportedInputError("pdf", `PDF has too many pages (${totalPages}); limit is ${PDF_MAX_PAGES}`);
    }
    try {
      info = (await getMeta(document)).info as Record<string, unknown>;
    } catch {
      info = {};
    }
    let chars = 0;
    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber++) {
      // Honor cancellation between pages so a huge PDF stops promptly.
      options.signal?.throwIfAborted();
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items
        .flatMap((item) => ("str" in item && item.str != null ? [item.str + (item.hasEOL ? "\n" : "")] : []))
        .join("");
      pages.push(text);
      chars += text.length;
      if (chars >= PDF_MAX_TEXT_CHARS) {
        truncated = pageNumber < totalPages;
        break;
      }
    }
  } finally {
    const cleanup = (document as { cleanup?: () => Promise<void> }).cleanup;
    if (typeof cleanup === "function") await cleanup.call(document).catch(() => undefined);
  }

  const quality = pdfQuality(pages);
  let markdown = cleanMarkdown(pagesToMarkdown(pages));
  let parseTier: Extracted["parseTier"] = "basic";
  let warning: string | null = null;

  let embeddedFigures: Extracted["embeddedFigures"];
  if (options.mineruUrl !== undefined && options.mineruUrl !== "") {
    try {
      const mineruMarkdown = await mineruParse(bytes, {
        mineruUrl: options.mineruUrl,
        filename: options.filename ?? "document.pdf",
        signal: options.signal,
        pages: totalPages,
        onProgress: options.onProgress,
        onWarning: (message) => {
          warning = message;
          options.onWarning?.(message);
        },
      });
      const processed = processMineruMarkdown(mineruMarkdown, {
        url: options.url ?? null,
        title: cleanTitle(stringValue(info.Title)),
        authors: splitAuthors(stringValue(info.Author)),
        license: options.license,
      });
      markdown = cleanMarkdown(processed.markdown);
      embeddedFigures = processed.embeddedFigures;
      parseTier = "mineru";
    } catch (error) {
      options.signal?.throwIfAborted();
      warning = `MinerU failed: ${messageOf(error)}; using unpdf text${quality.ok ? "" : ` (poor PDF text layer: ${quality.reason})`}.`;
      options.onWarning?.(warning);
    }
  } else if (!quality.ok) {
    warning = `poor PDF text layer (${quality.reason}); set MINERU_URL for better extraction`;
  } else if (truncated) {
    warning = `extraction truncated after ${PDF_MAX_TEXT_CHARS} characters`;
  }

  return {
    ...(embeddedFigures ? { embeddedFigures } : {}),
    title: cleanTitle(stringValue(info.Title)),
    authors: splitAuthors(stringValue(info.Author)),
    markdown,
    pages: totalPages > 0 ? totalPages : pages.length,
    parseTier,
    warning,
    url: options.url ?? null,
    originalExt: "pdf",
  };
}

function pagesToMarkdown(pages: string[]): string {
  return pages
    .map((page, index) => {
      const body = page.trim();
      return body === "" ? `<!-- p:${index + 1} -->` : `<!-- p:${index + 1} -->\n\n${body}`;
    })
    .join("\n\n");
}

function stringValue(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function cleanTitle(title: string | null): string | null {
  if (title === null) return null;
  const cleaned = title
    .replace(/^Microsoft Word\s*-\s*/i, "")
    .replace(/\.(pdf|docx?)$/i, "")
    .trim();
  if (cleaned === "" || /^(untitled|unknown)$/i.test(cleaned)) return null;
  return cleaned;
}

function splitAuthors(author: string | null): string[] {
  if (author === null) return [];
  const parts = author
    .split(/;|\band\b/i)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return parts.length > 0 ? parts : [];
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
