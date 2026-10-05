import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { cleanMarkdown } from "./clean.js";
import { figureLicense } from "./figures.js";
import { firecrawlScrape } from "./firecrawl.js";
import { preserveTex, structureRules } from "./html-structure.js";
import { collectImages, type SourceImage } from "./images.js";
import { politeFetch } from "./polite-fetch.js";
import { MIN_PARSE_QUALITY, scoreParseQuality } from "./quality.js";
import { decodeBody, SAFE_FETCH_MAX_BYTES } from "./safe-fetch.js";
import { fetchStrategy } from "./strategies.js";
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
  images: SourceImage[];
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
  structureRules(service);
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

  const licenseLinks: string[] = [];
  for (const node of document.querySelectorAll(
    'a[rel="license"], a[href*="creativecommons.org/licenses/"], a[href*="creativecommons.org/publicdomain/"]',
  )) {
    if (node.closest("figure")) continue;
    if (
      node.getAttribute("rel") === "license" ||
      node.closest("footer") ||
      /\blicen[sc]e|copyright/i.test(node.parentElement?.textContent ?? "")
    )
      licenseLinks.push(node.getAttribute("href") ?? "");
  }
  const pageLicense =
    url && !/(?:^|\.)wikipedia\.org$/.test(new URL(url).hostname)
      ? (libreTextsLicense(html, url) ?? figureLicense(licenseLinks.join(" ")))
      : undefined;
  const captions = new Map<string, string>();
  const licenses = new Map<string, string>();
  for (const figure of document.querySelectorAll("figure")) {
    const caption = figure.querySelector("figcaption")?.textContent?.trim();
    const src = figure.querySelector("img")?.getAttribute("src");
    if (src && url) {
      try {
        const imageUrl = new URL(src, url).href;
        if (caption) captions.set(imageUrl, caption);
        const license = /all rights reserved/i.test(caption ?? "")
          ? "all rights reserved"
          : figureLicense(
              `${caption ?? ""} ${[...figure.querySelectorAll("a")].map((a) => a.getAttribute("href")).join(" ")}`,
            );
        if (license) licenses.set(imageUrl, license);
      } catch {
        /* Ignore invalid image URLs. */
      }
    }
  }
  const math = preserveTex(document);
  for (const pre of document.querySelectorAll("pre")) {
    const token = `STUDIUMCODE${math.size}END`;
    math.set(token, createTurndown().turndown(pre.outerHTML));
    pre.replaceWith(document.createTextNode(token));
  }
  for (const node of document.querySelectorAll("nav, footer, script, style, noscript")) node.remove();
  const readability = new Readability(document as unknown as ConstructorParameters<typeof Readability>[0]);
  const article = readability.parse();
  const title = firstNonEmpty(article?.title, document.title);
  const byline = firstNonEmpty(article?.byline);
  const sourceHtml = article?.content ?? document.body?.innerHTML ?? html;
  let markdown = createTurndown().turndown(sourceHtml);
  for (const [token, tex] of math) markdown = markdown.replaceAll(token, () => tex);
  // Readability strips the article's own <h1>; re-add it so the source keeps its title.
  const withTitle = title !== null && !hasHeading(markdown, title) ? `# ${title}\n\n${markdown}` : markdown;
  return {
    title,
    byline,
    markdown: cleanMarkdown(withTitle),
    images: url
      ? collectImages(withTitle, url).map((image) => ({
          ...image,
          ...(licenses.has(image.url) || pageLicense ? { license: licenses.get(image.url) ?? pageLicense } : {}),
          ...(captions.has(image.url) ? { caption: captions.get(image.url) } : {}),
          ...(licenses.has(image.url) && captions.has(image.url)
            ? { credit: `${captions.get(image.url)}, ${url}` }
            : {}),
        }))
      : [],
  };
}

/**
 * Fetch and extract a web page. Firecrawl is used when configured; if it fails
 * the built-in readability path runs and the failure is surfaced as a warning.
 */
export async function extractWeb(url: string, options: WebExtractOptions = {}): Promise<Extracted> {
  let firecrawlWarning: string | null = null;
  let first: Extracted | null = null;
  if (fetchStrategy(url).kind === "wiki-api") {
    try {
      return await (await import("./wikipedia.js")).extractWikipedia(url, options);
    } catch (error) {
      options.signal?.throwIfAborted();
      firecrawlWarning = `Wiki API failed: ${messageOf(error)}`;
    }
  }
  if (options.firecrawlUrl !== undefined && options.firecrawlUrl !== "") {
    try {
      const scraped = await firecrawlScrape(url, {
        baseUrl: options.firecrawlUrl,
        apiKey: options.firecrawlKey,
        signal: options.signal,
        includeHtml: true,
        waitFor: fetchStrategy(url).waitFor,
      });
      const converted = scraped.html ? htmlToMarkdown(scraped.html, scraped.url ?? url) : null;
      const rich =
        converted && scoreParseQuality(converted.markdown).score >= scoreParseQuality(scraped.markdown).score
          ? converted.markdown
          : scraped.markdown;
      first = {
        title: scraped.title,
        authors: [],
        markdown: cleanMarkdown(rich),
        images: converted?.images ?? collectImages(rich, scraped.url ?? url),
        pages: null,
        parseTier: "firecrawl",
        warning: null,
        url: scraped.url,
        originalExt: null,
      };
      if (scoreParseQuality(first.markdown).score >= MIN_PARSE_QUALITY) return first;
    } catch (error) {
      firecrawlWarning = `Firecrawl failed: ${messageOf(error)}`;
    }
  }

  let response: Awaited<ReturnType<typeof politeFetch>>;
  try {
    response = await politeFetch(fetchStrategy(url).url, { signal: options.signal, maxBytes: SAFE_FETCH_MAX_BYTES });
  } catch (error) {
    if (first) return first;
    throw new Error(`${firecrawlWarning ? `${firecrawlWarning}; direct: ` : ""}${messageOf(error)}`);
  }
  const converted = htmlToMarkdown(decodeBody(response.bytes, response.contentType), response.url);
  const warning = firecrawlWarning ?? (converted.markdown.trim() === "" ? "no readable content found" : null);
  const direct: Extracted = {
    title: converted.title,
    authors: bylineAuthors(converted.byline),
    markdown: converted.markdown,
    images: converted.images,
    pages: null,
    parseTier: "basic",
    warning,
    url: response.url,
    originalExt: null,
  };
  return first && scoreParseQuality(first.markdown).score >= scoreParseQuality(direct.markdown).score ? first : direct;
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

/** LibreTexts embeds the page's explicit license tags even when its footer is dynamic. */
function libreTextsLicense(html: string, url: string): string | undefined {
  if (!/(?:^|\.)libretexts\.org$/.test(new URL(url).hostname)) return undefined;
  const tag = /["']license:(ccby(?:nc|nd|sa)*|cc0|publicdomain)["']/i.exec(html)?.[1]?.toLowerCase();
  if (!tag) return undefined;
  const version = /["']licenseversion:(\d)(\d)["']/i.exec(html);
  const label =
    tag === "publicdomain"
      ? "public domain"
      : tag === "cc0"
        ? "CC0"
        : `CC BY${
            tag
              .slice(4)
              .match(/nc|nd|sa/g)
              ?.map((part) => `-${part.toUpperCase()}`)
              .join("") ?? ""
          }`;
  return `${label}${version && tag !== "publicdomain" ? ` ${version[1]}.${version[2]}` : ""}`;
}
