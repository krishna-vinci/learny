import type { YoutubeTranscriptStatus } from "@studium/shared";
import type { YoutubeTranscriptEngine } from "../youtube/types.js";
import { arxivPdfUrl } from "./detect.js";
import { extractDocx } from "./docx.js";
import { extractEpub } from "./epub.js";
import { extractPdf } from "./pdf.js";
import { MIN_PARSE_QUALITY, scoreParseQuality } from "./quality.js";
import { decodeBody, INGEST_MAX_BYTES, SAFE_FETCH_MAX_BYTES, safeFetch } from "./safe-fetch.js";
import { fetchStrategy } from "./strategies.js";
import { extractWeb, htmlToMarkdown } from "./web.js";
import { extractWikipedia } from "./wikipedia.js";
import { extractYoutube } from "./youtube.js";

export type InputKind =
  | "pdf"
  | "epub"
  | "docx"
  | "pptx"
  | "html"
  | "markdown"
  | "text"
  | "web"
  | "wikipedia"
  | "youtube"
  | "arxiv"
  | "doi"
  | "image"
  | "audio";

export interface Extracted {
  title: string | null;
  authors: string[];
  markdown: string;
  pages: number | null;
  parseTier: "basic" | "mineru" | "firecrawl" | "transcript";
  warning: string | null;
  url: string | null;
  originalExt: string | null;
  thumb?: Uint8Array;
  images?: import("./images.js").SourceImage[];
  /**
   * True when the input carries metadata but no readable text (an embed-only
   * YouTube video). Downstream agents must treat such a source as unreadable.
   */
  unreadable?: boolean;
  /** YouTube transcript ladder outcome for embed-only video sources. */
  transcriptStatus?: YoutubeTranscriptStatus | null;
}

export interface ExtractInput {
  url?: string;
  bytes?: Uint8Array;
  filename?: string;
  mime?: string;
}

export interface ExtractOptions {
  mineruUrl?: string;
  firecrawlUrl?: string;
  firecrawlKey?: string;
  signal?: AbortSignal;
  /** Instance YouTube integration used by the transcript ladder. */
  youtube?: YoutubeTranscriptEngine;
}

/** Thrown for inputs T4 deliberately cannot handle (images, audio, PPTX). */
export class UnsupportedInputError extends Error {
  readonly kind: InputKind | "unknown";

  constructor(kind: InputKind | "unknown", message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UnsupportedInputError";
    this.kind = kind;
  }
}

/**
 * Route an already-classified input to the matching extractor and normalize
 * the result into {@link Extracted}.
 */
export async function extract(kind: InputKind, input: ExtractInput, options: ExtractOptions = {}): Promise<Extracted> {
  switch (kind) {
    case "pdf": {
      const bytes = await readBytes(input, options);
      return extractPdf(bytes, {
        url: input.url ?? null,
        filename: input.filename ?? null,
        mineruUrl: options.mineruUrl,
        signal: options.signal,
      });
    }
    case "epub": {
      const bytes = await readBytes(input, options);
      return extractEpub(bytes, { url: input.url ?? null, filename: input.filename ?? null });
    }
    case "docx": {
      const bytes = await readBytes(input, options);
      return extractDocx(bytes, { url: input.url ?? null, filename: input.filename ?? null });
    }
    case "pptx":
      throw new UnsupportedInputError(
        "pptx",
        "PPTX ingestion is not available yet; convert the deck to PDF or DOCX first.",
      );
    case "web": {
      const url = requireUrl(kind, input);
      return extractWeb(url, {
        firecrawlUrl: options.firecrawlUrl,
        firecrawlKey: options.firecrawlKey,
        signal: options.signal,
      });
    }
    case "wikipedia": {
      const url = requireUrl(kind, input);
      return extractWikipedia(url, { signal: options.signal });
    }
    case "youtube": {
      const url = requireUrl(kind, input);
      return extractYoutube(url, {
        signal: options.signal,
        ...(options.youtube === undefined ? {} : { youtube: options.youtube }),
      });
    }
    case "arxiv": {
      const url = requireUrl(kind, input);
      try {
        const html = await extractWeb(fetchStrategy(url).url, { signal: options.signal });
        if (scoreParseQuality(html.markdown).score >= MIN_PARSE_QUALITY) return { ...html, url };
      } catch {
        options.signal?.throwIfAborted();
      }
      const pdfUrl = arxivPdfUrl(url);
      const response = await safeFetch(pdfUrl, { signal: options.signal, maxBytes: INGEST_MAX_BYTES });
      return extractPdf(response.bytes, {
        url,
        filename: null,
        mineruUrl: options.mineruUrl,
        signal: options.signal,
      });
    }
    case "doi": {
      const value = requireUrl(kind, input);
      const doiUrl = /^https?:/i.test(value) ? value : `https://doi.org/${encodeURI(value)}`;
      const response = await safeFetch(doiUrl, { signal: options.signal, maxBytes: INGEST_MAX_BYTES });
      if (response.contentType?.toLowerCase().includes("pdf") === true) {
        return extractPdf(response.bytes, {
          url: response.url,
          filename: null,
          mineruUrl: options.mineruUrl,
          signal: options.signal,
        });
      }
      const converted = htmlToMarkdown(decodeBody(response.bytes, response.contentType), response.url);
      return {
        title: converted.title,
        authors: [],
        markdown: converted.markdown,
        images: converted.images,
        pages: null,
        parseTier: "basic",
        warning: null,
        url: response.url,
        originalExt: null,
      };
    }
    case "html": {
      const { text, url } = await readText(input, options);
      const converted = htmlToMarkdown(text, url ?? undefined);
      return {
        title: converted.title,
        authors: [],
        markdown: converted.markdown,
        images: converted.images,
        pages: null,
        parseTier: "basic",
        warning: null,
        url,
        originalExt: extOf(input),
      };
    }
    case "markdown":
    case "text": {
      const { text, url } = await readText(input, options);
      return {
        title: firstHeading(text),
        authors: [],
        markdown: text.endsWith("\n") ? text : `${text}\n`,
        pages: null,
        parseTier: "basic",
        warning: null,
        url,
        originalExt: extOf(input),
      };
    }
    case "image":
      throw new UnsupportedInputError(
        "image",
        "Image ingestion needs a vision-capable model; it is handled by the ingest job, not the extractor.",
      );
    case "audio":
      throw new UnsupportedInputError("audio", "Audio ingestion is not supported.");
  }
}

function requireUrl(kind: InputKind, input: ExtractInput): string {
  if (input.url === undefined || input.url === "") {
    throw new UnsupportedInputError(kind, `Cannot extract a ${kind} input without a URL.`);
  }
  return input.url;
}

async function readBytes(input: ExtractInput, options: ExtractOptions): Promise<Uint8Array> {
  if (input.bytes !== undefined) return input.bytes;
  if (input.url !== undefined) {
    const response = await safeFetch(input.url, { signal: options.signal, maxBytes: INGEST_MAX_BYTES });
    return response.bytes;
  }
  throw new UnsupportedInputError("unknown", "Extraction requires either bytes or a URL.");
}

async function readText(input: ExtractInput, options: ExtractOptions): Promise<{ text: string; url: string | null }> {
  if (input.bytes !== undefined) {
    return { text: decodeBody(input.bytes, input.mime ?? null), url: input.url ?? null };
  }
  if (input.url !== undefined) {
    const response = await safeFetch(input.url, { signal: options.signal, maxBytes: SAFE_FETCH_MAX_BYTES });
    return { text: decodeBody(response.bytes, response.contentType), url: response.url };
  }
  throw new UnsupportedInputError("unknown", "Extraction requires either bytes or a URL.");
}

function firstHeading(text: string): string | null {
  const match = /^#\s+(.+?)\s*$/m.exec(text);
  return match?.[1] ?? null;
}

function extOf(input: ExtractInput): string | null {
  const source = input.filename ?? input.url ?? "";
  const match = /\.([A-Za-z0-9]+)(?:[?#].*)?$/.exec(source);
  return match?.[1]?.toLowerCase() ?? null;
}
