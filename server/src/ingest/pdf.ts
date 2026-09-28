import { extractText, getDocumentProxy, getMeta } from "unpdf";
import { cleanMarkdown, pdfQuality } from "./clean.js";
import { mineruParse } from "./mineru.js";
import type { Extracted } from "./types.js";

export interface PdfExtractOptions {
  url?: string | null;
  filename?: string | null;
  mineruUrl?: string;
  signal?: AbortSignal;
}

/**
 * Extract text from a PDF with page anchors (`<!-- p:N -->`). When the text
 * layer looks poor and MinerU is configured, the original is re-parsed there;
 * otherwise the basic text is kept with a `parse_warning`.
 */
export async function extractPdf(bytes: Uint8Array, options: PdfExtractOptions = {}): Promise<Extracted> {
  // pdf.js takes ownership of (and may detach) the buffer it is given, so hand it
  // a copy and keep `bytes` intact for the MinerU fallback and the original file.
  const document = await getDocumentProxy(bytes.slice());
  let info: Record<string, unknown> = {};
  let pages: string[] = [];
  let totalPages = 0;
  try {
    try {
      info = (await getMeta(document)).info as Record<string, unknown>;
    } catch {
      info = {};
    }
    const result = (await extractText(document, { mergePages: false })) as { totalPages: number; text: string[] };
    pages = result.text;
    totalPages = result.totalPages;
  } finally {
    const cleanup = (document as { cleanup?: () => Promise<void> }).cleanup;
    if (typeof cleanup === "function") await cleanup.call(document).catch(() => undefined);
  }

  const quality = pdfQuality(pages);
  let markdown = cleanMarkdown(pagesToMarkdown(pages));
  let parseTier: Extracted["parseTier"] = "basic";
  let warning: string | null = null;

  if (!quality.ok && options.mineruUrl !== undefined && options.mineruUrl !== "") {
    try {
      const mineruMarkdown = await mineruParse(bytes, {
        mineruUrl: options.mineruUrl,
        filename: options.filename ?? "document.pdf",
        signal: options.signal,
      });
      markdown = cleanMarkdown(mineruMarkdown);
      parseTier = "mineru";
    } catch (error) {
      warning = `poor PDF text layer (${quality.reason}); MinerU failed: ${messageOf(error)}`;
    }
  } else if (!quality.ok) {
    warning = `poor PDF text layer (${quality.reason}); set MINERU_URL for better extraction`;
  }

  return {
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
