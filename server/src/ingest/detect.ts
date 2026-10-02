import { parseYoutubeVideo } from "@studium/shared/media";
import { type InputKind, UnsupportedInputError } from "./types.js";

export interface DetectInput {
  url?: string;
  filename?: string;
  mime?: string;
  bytes?: Uint8Array;
}

// Extensions of files that arrive as bytes.
const FILE_EXT_KINDS: Record<string, InputKind> = {
  pdf: "pdf",
  epub: "epub",
  docx: "docx",
  pptx: "pptx",
  html: "html",
  htm: "html",
  xhtml: "html",
  md: "markdown",
  markdown: "markdown",
  mdx: "markdown",
  txt: "text",
  text: "text",
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  tif: "image",
  tiff: "image",
  heic: "image",
  avif: "image",
  svg: "image",
  mp3: "audio",
  m4a: "audio",
  wav: "audio",
  aac: "audio",
  ogg: "audio",
  flac: "audio",
  opus: "audio",
};

// Extensions of links; HTML pages are routed through the readability fetch.
const URL_EXT_KINDS: Record<string, InputKind> = {
  ...FILE_EXT_KINDS,
  html: "web",
  htm: "web",
  xhtml: "web",
};

const MIME_KINDS: Record<string, InputKind> = {
  "application/pdf": "pdf",
  "application/epub+zip": "epub",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "text/html": "html",
  "application/xhtml+xml": "html",
  "text/markdown": "markdown",
  "text/x-markdown": "markdown",
  "text/plain": "text",
};

/**
 * Classify an input into an {@link InputKind}. URLs win over bytes; among the
 * rest, filename beats MIME type beats a magic-byte sniff.
 */
export function detectInput(input: DetectInput): InputKind {
  if (input.url !== undefined && input.url !== "") {
    const kind = detectFromUrl(input.url);
    if (kind !== null) return kind;
    return "web";
  }

  if (input.filename !== undefined) {
    const kind = fileExtKind(input.filename);
    if (kind !== null) return kind;
  }

  if (input.mime !== undefined) {
    const kind = mimeKind(input.mime);
    if (kind !== null) return kind;
  }

  if (input.bytes !== undefined) {
    const kind = sniffBytes(input.bytes);
    if (kind !== null) return kind;
  }

  throw new UnsupportedInputError(
    "unknown",
    "Could not detect the input kind from the supplied URL, filename or bytes.",
  );
}

function detectFromUrl(raw: string): InputKind | null {
  if (parseYoutubeVideo(raw)) return "youtube";
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  if (host === "wikipedia.org" || host.endsWith(".wikipedia.org")) return "wikipedia";
  if (host === "arxiv.org" || host.endsWith(".arxiv.org")) return "arxiv";
  if (host === "doi.org" || host.endsWith(".doi.org")) return "doi";
  return urlExtKind(url.pathname);
}

function fileExtKind(name: string): InputKind | null {
  return extKind(name, FILE_EXT_KINDS);
}

function urlExtKind(pathname: string): InputKind | null {
  return extKind(pathname, URL_EXT_KINDS);
}

function extKind(pathname: string, table: Record<string, InputKind>): InputKind | null {
  const match = /\.([A-Za-z0-9]+)$/.exec(pathname.replace(/[?#].*$/, ""));
  if (match?.[1] === undefined) return null;
  return table[match[1].toLowerCase()] ?? null;
}

function mimeKind(mime: string): InputKind | null {
  const normalized = mime.toLowerCase().split(";")[0]?.trim() ?? "";
  if (normalized === "") return null;
  if (normalized.startsWith("image/")) return "image";
  if (normalized.startsWith("audio/")) return "audio";
  return MIME_KINDS[normalized] ?? null;
}

function sniffBytes(bytes: Uint8Array): InputKind | null {
  if (bytes.length === 0) return null;
  if (startsWithAscii(bytes, "%PDF")) return "pdf";
  if (bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    const ascii = latin1(bytes.subarray(0, 4096));
    if (ascii.includes("application/epub+zip")) return "epub";
    if (ascii.includes("word/")) return "docx";
    if (ascii.includes("ppt/")) return "pptx";
    if (ascii.includes("[Content_Types].xml")) return "docx";
    return null;
  }
  const head = latin1(bytes.subarray(0, 512)).trimStart().toLowerCase();
  if (head.startsWith("<!doctype html") || head.startsWith("<html") || head.startsWith("<?xml")) return "html";
  if (!bytes.includes(0x00)) return "text";
  return null;
}

function startsWithAscii(bytes: Uint8Array, prefix: string): boolean {
  if (bytes.length < prefix.length) return false;
  for (let index = 0; index < prefix.length; index++) {
    if (bytes[index] !== prefix.charCodeAt(index)) return false;
  }
  return true;
}

function latin1(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

/** Normalize an arXiv URL or bare id to its PDF download URL. */
export function arxivPdfUrl(value: string): string {
  let candidate = value.trim();
  const fromUrl = /arxiv\.org\/(?:abs|pdf)\/([^?#]+)/i.exec(candidate);
  if (fromUrl?.[1] !== undefined) candidate = decodeURIComponent(fromUrl[1]);
  candidate = candidate
    .replace(/^arxiv:/i, "")
    .replace(/\.pdf$/i, "")
    .trim();
  if (/^\d{4}\.\d{4,5}(v\d+)?$/i.test(candidate) || /^[a-z-]+(\.[A-Z]{2})?\/\d{7}(v\d+)?$/.test(candidate)) {
    return `https://arxiv.org/pdf/${candidate}`;
  }
  throw new UnsupportedInputError("arxiv", `Not a recognized arXiv identifier: ${value}`);
}
