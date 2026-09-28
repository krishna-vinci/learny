import { Buffer } from "node:buffer";
import JSZip from "jszip";
import { DOMParser } from "linkedom";
import mammoth from "mammoth";
import { cleanMarkdown } from "./clean.js";
import type { Extracted } from "./types.js";
import { createTurndown } from "./web.js";

export interface DocxExtractOptions {
  url?: string | null;
  filename?: string | null;
}

/** Extract a DOCX to markdown with mammoth, plus best-effort core metadata. */
export async function extractDocx(bytes: Uint8Array, options: DocxExtractOptions = {}): Promise<Extracted> {
  const { value: html } = await mammoth.convertToHtml({ buffer: Buffer.from(bytes) });
  const markdown = cleanMarkdown(createTurndown().turndown(html));
  const meta = await readCoreProperties(bytes);

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

async function readCoreProperties(bytes: Uint8Array): Promise<{ title: string | null; creators: string[] }> {
  try {
    const zip = await JSZip.loadAsync(bytes);
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
