import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { cleanMarkdown } from "./clean.js";
import { firecrawlScrape } from "./firecrawl.js";
import { decodeBody, SAFE_FETCH_MAX_BYTES, safeFetch } from "./safe-fetch.js";
import type { Extracted } from "./types.js";

export interface WebExtractOptions {
  firecrawlUrl?: string;
  firecrawlKey?: string;
  signal?: AbortSignal;
}

export interface MarkdownConversion {
  title: string | null;
  byline: string | null;
  markdown: string;
}

/** Turndown configured for the markdown conventions used across the study tree. */
export function createTurndown(): TurndownService {
  const service = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    bulletListMarker: "-",
    emDelimiter: "*",
  });
  service.remove(["script", "style", "noscript"]);
  return service;
}

/**
 * Convert an HTML document to cleaned markdown using readability for the main
 * article and turndown for the serialization.
 */
export function htmlToMarkdown(html: string, url?: string): MarkdownConversion {
  const { document } = parseHTML(html);
  if (url !== undefined && document.querySelector("base") === null) {
    const base = document.createElement("base");
    base.setAttribute("href", url);
    document.head?.prepend(base);
  }

  const readability = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0]);
  const article = readability.parse();
  const title = firstNonEmpty(article?.title, document.title);
  const byline = firstNonEmpty(article?.byline);
  const sourceHtml = article?.content ?? document.body?.innerHTML ?? html;
  const markdown = createTurndown().turndown(sourceHtml);
  // Readability strips the article's own <h1>; re-add it so the source keeps its title.
  const withTitle = title !== null && !hasHeading(markdown, title) ? `# ${title}\n\n${markdown}` : markdown;
  return { title, byline, markdown: cleanMarkdown(withTitle) };
}

/**
 * Fetch and extract a web page. Firecrawl is used when configured; if it fails
 * the built-in readability path runs and the failure is surfaced as a warning.
 */
export async function extractWeb(url: string, options: WebExtractOptions = {}): Promise<Extracted> {
  let firecrawlWarning: string | null = null;
  if (options.firecrawlUrl !== undefined && options.firecrawlUrl !== "") {
    try {
      const scraped = await firecrawlScrape(url, {
        baseUrl: options.firecrawlUrl,
        apiKey: options.firecrawlKey,
        signal: options.signal,
      });
      return {
        title: scraped.title,
        authors: [],
        markdown: cleanMarkdown(scraped.markdown),
        pages: null,
        parseTier: "firecrawl",
        warning: null,
        url: scraped.url,
        originalExt: null,
      };
    } catch (error) {
      firecrawlWarning = `Firecrawl failed: ${messageOf(error)}`;
    }
  }

  const response = await safeFetch(url, { signal: options.signal, maxBytes: SAFE_FETCH_MAX_BYTES });
  const converted = htmlToMarkdown(decodeBody(response.bytes, response.contentType), response.url);
  const warning = firecrawlWarning ?? (converted.markdown.trim() === "" ? "no readable content found" : null);
  return {
    title: converted.title,
    authors: bylineAuthors(converted.byline),
    markdown: converted.markdown,
    pages: null,
    parseTier: "basic",
    warning,
    url: response.url,
    originalExt: null,
  };
}

function firstNonEmpty(...values: (string | null | undefined)[]): string | null {
  for (const value of values) {
    if (typeof value === "string" && value.trim() !== "") return value.trim();
  }
  return null;
}

function hasHeading(markdown: string, title: string): boolean {
  return markdown.split("\n").some((line) => /^#{1,6}\s+/.test(line) && line.replace(/^#+\s+/, "").trim() === title);
}

function bylineAuthors(byline: string | null): string[] {
  if (byline === null) return [];
  return byline
    .split(/,|\band\b|\|/i)
    .map((part) => part.trim())
    .filter((part) => part !== "" && part.length <= 80);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
