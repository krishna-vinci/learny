import { Buffer } from "node:buffer";
import JSZip from "jszip";
import { DOMParser } from "linkedom";
import mammoth from "mammoth";
import { cleanMarkdown } from "./clean.js";
import { type Extracted, UnsupportedInputError } from "./types.js";
import { createTurndown } from "./web.js";

export interface DocxExtractOptions {
  url?: string | null;
  filename?: string | null;
}

/** Cap on the declared uncompressed size of `word/document.xml` (mammoth input). */
export const DOCX_MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;

/** Extract a DOCX to markdown with mammoth, plus best-effort core metadata. */
export async function extractDocx(bytes: Uint8Array, options: DocxExtractOptions = {}): Promise<Extracted> {
  const zip = await JSZip.loadAsync(bytes);
  assertDocumentWithinLimits(zip);
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  const markdown = cleanMarkdown(createTurndown().turndown(html));
  const meta = await readCoreProperties(zip);

  return {
    title: meta.title,
    authors: meta.creators,
    markdown,
    pages: null,
    parseTier: "basic",
    warning: html.trim() === "" ? "DOCX contained no readable content" : null,
    url: options.url ?? null,
    originalExt: "docx",
  };
}

/** Reject an oversized `word/document.xml` before mammoth inflates it. */
function assertDocumentWithinLimits(zip: JSZip): void {
  const document = zip.file("word/document.xml");
  if (document === null) throw new UnsupportedInputError("docx", "DOCX is missing word/document.xml");
  if (declaredUncompressedSize(document) > DOCX_MAX_DOCUMENT_BYTES) {
    throw new UnsupportedInputError("docx", "DOCX word/document.xml expands to too much data");
  }
}

/** The declared uncompressed byte count JSZip read from the zip central directory. */
function declaredUncompressedSize(entry: unknown): number {
  if (typeof entry !== "object" || entry === null) return 0;
  const data = (entry as { _data?: { uncompressedSize?: unknown } })._data;
  const size = data?.uncompressedSize;
  return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : 0;
}

async function readCoreProperties(zip: JSZip): Promise<{ title: string | null; creators: string[] }> {
  try {
    const core = zip.file("docProps/core.xml");
    if (core === null) return { title: null, creators: [] };
    const document = new DOMParser().parseFromString(await core.async("string"), "text/xml");
    const title = firstText(document, "dc:title");
    const creators = [...document.getElementsByTagName("dc:creator")]
      .map((element) => element.textContent?.trim() ?? "")
      .filter((text) => text !== "");
    return { title, creators };
  } catch {
    return { title: null, creators: [] };
  }
}

function firstText(document: ReturnType<DOMParser["parseFromString"]>, tag: string): string | null {
  const text = document.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
  return text === "" ? null : text;
}
