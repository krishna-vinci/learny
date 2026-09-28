import path from "node:path";
import JSZip from "jszip";
import { DOMParser, parseHTML } from "linkedom";
import { cleanMarkdown } from "./clean.js";
import { type Extracted, UnsupportedInputError } from "./types.js";
import { createTurndown } from "./web.js";

export interface EpubExtractOptions {
  url?: string | null;
  filename?: string | null;
}

/** Caps on a declared archive, checked before any entry is inflated. */
export const EPUB_MAX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;
export const EPUB_MAX_ENTRIES = 5000;
export const EPUB_MAX_SPINE = 2000;

/** Extract an EPUB: unzip the OPF spine and convert each XHTML chapter to markdown. */
export async function extractEpub(bytes: Uint8Array, options: EpubExtractOptions = {}): Promise<Extracted> {
  const zip = await JSZip.loadAsync(bytes);
  assertArchiveWithinLimits(zip);

  const containerFile = zip.file("META-INF/container.xml");
  if (containerFile === null) throw new UnsupportedInputError("epub", "EPUB is missing META-INF/container.xml");
  const container = parseXml(await containerFile.async("string"));
  const opfPath = container.querySelector("rootfile")?.getAttribute("full-path");
  if (opfPath === null || opfPath === undefined || opfPath === "") {
    throw new UnsupportedInputError("epub", "EPUB container has no rootfile path");
  }

  const opfFile = zip.file(opfPath);
  if (opfFile === null) throw new UnsupportedInputError("epub", `EPUB is missing its OPF: ${opfPath}`);
  const opf = parseXml(await opfFile.async("string"));

  const title = firstText(opf, "dc:title") ?? firstText(opf, "title");
  const authors = allText(opf, "dc:creator");
  const baseDir = path.posix.dirname(opfPath);

  const manifest = new Map<string, string>();
  for (const item of opf.getElementsByTagName("item")) {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id !== null && id !== "" && href !== null && href !== "") manifest.set(id, href);
  }

  const spine: string[] = [];
  for (const itemref of opf.getElementsByTagName("itemref")) {
    const idref = itemref.getAttribute("idref");
    const href = idref === null ? undefined : manifest.get(idref);
    if (href !== undefined) spine.push(resolveHref(baseDir, href));
  }
  if (spine.length === 0) {
    for (const href of manifest.values()) spine.push(resolveHref(baseDir, href));
  }
  if (spine.length > EPUB_MAX_SPINE) {
    throw new UnsupportedInputError("epub", `EPUB spine has too many items (${spine.length})`);
  }

  const turndown = createTurndown();
  const chapters: string[] = [];
  for (const href of spine) {
    const file = zip.file(href) ?? zip.file(decodeHref(href));
    if (file === null) continue;
    const html = await file.async("string");
    const { document } = parseHTML(html);
    const body = document.body?.innerHTML ?? html;
    const markdown = turndown.turndown(body).trim();
    if (markdown !== "") chapters.push(markdown);
  }

  return {
    title,
    authors,
    markdown: cleanMarkdown(chapters.join("\n\n")),
    pages: null,
    parseTier: "basic",
    warning: chapters.length === 0 ? "EPUB contained no readable chapters" : null,
    url: options.url ?? null,
    originalExt: "epub",
  };
}

/**
 * Reject a zip whose declared central-directory sizes/counts are oversized,
 * before JSZip inflates a single entry (decision: aggregate bomb protection).
 */
function assertArchiveWithinLimits(zip: JSZip): void {
  const entries = Object.values(zip.files).filter((entry) => !entry.dir);
  if (entries.length > EPUB_MAX_ENTRIES) {
    throw new UnsupportedInputError("epub", `EPUB has too many archive entries (${entries.length})`);
  }
  let total = 0;
  for (const entry of entries) total += declaredUncompressedSize(entry);
  if (total > EPUB_MAX_UNCOMPRESSED_BYTES) {
    throw new UnsupportedInputError(
      "epub",
      `EPUB expands to too much data (${Math.round(total / 1024 / 1024)} MB uncompressed)`,
    );
  }
}

/** The declared uncompressed byte count JSZip read from the zip central directory. */
function declaredUncompressedSize(entry: unknown): number {
  if (typeof entry !== "object" || entry === null) return 0;
  const data = (entry as { _data?: { uncompressedSize?: unknown } })._data;
  const size = data?.uncompressedSize;
  return typeof size === "number" && Number.isFinite(size) && size > 0 ? size : 0;
}

function parseXml(xml: string): ReturnType<DOMParser["parseFromString"]> {
  return new DOMParser().parseFromString(xml, "text/xml");
}

function resolveHref(baseDir: string, href: string): string {
  const withoutFragment = href.split("#")[0] ?? href;
  return path.posix.normalize(path.posix.join(baseDir, withoutFragment));
}

function decodeHref(href: string): string {
  try {
    return decodeURIComponent(href);
  } catch {
    return href;
  }
}

function firstText(document: ReturnType<DOMParser["parseFromString"]>, tag: string): string | null {
  const text = document.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
  return text === "" ? null : text;
}

function allText(document: ReturnType<DOMParser["parseFromString"]>, tag: string): string[] {
  return [...document.getElementsByTagName(tag)]
    .map((element) => element.textContent?.trim() ?? "")
    .filter((text) => text !== "");
}
