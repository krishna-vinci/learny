import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const WIKIPEDIA_HOST = "https://en.wikipedia.org";
const MAX_MARKDOWN_BYTES = 60 * 1024;
const REQUEST_TIMEOUT_MS = 15_000;

interface ToolDetails {
  isError: boolean;
  summary: string;
}

interface WikiSearchResult {
  id: number;
  key: string;
  title: string;
  excerpt?: string;
  description?: string;
}

function result(summary: string, text: string) {
  return {
    content: [{ type: "text" as const, text }],
    details: { isError: false as boolean, summary } satisfies ToolDetails,
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: "text" as const, text: `Error: ${message}` }],
    details: { isError: true as boolean, summary: message } satisfies ToolDetails,
  };
}

function stripTags(value: string | undefined): string {
  return (value ?? "")
    .replace(/<[^>]*>/g, "")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .trim();
}

function truncateBytes(text: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return text;
  let length = Math.floor((text.length * maxBytes) / bytes);
  while (length > 0 && Buffer.byteLength(text.slice(0, length), "utf8") > maxBytes) length--;
  return `${text.slice(0, length)}\n\n[Truncated at 60 KB]`;
}

async function requestJson(url: string): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "application/json", "user-agent": "Studium/0.0 (+https://studium.local)" },
    });
    if (!response.ok) throw new Error(`Wikipedia request failed with HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function requestText(url: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: "text/html", "user-agent": "Studium/0.0 (+https://studium.local)" },
    });
    if (!response.ok) throw new Error(`Wikipedia request failed with HTTP ${response.status}`);
    return await response.text();
  } finally {
    clearTimeout(timer);
  }
}

function searchMarkdown(query: string, pages: WikiSearchResult[]): string {
  const entries = pages.map((page) => {
    const description = page.description === undefined ? "" : ` — ${page.description}`;
    const excerpt = stripTags(page.excerpt);
    return [`- **${page.title}**${description}`, excerpt === "" ? undefined : `  ${excerpt}`]
      .filter((line) => line !== undefined)
      .join("\n");
  });
  return [`# Wikipedia search: ${query}`, "", "Use wiki_read with the exact title above.", "", entries.join("\n")].join(
    "\n",
  );
}

async function readMarkdown(title: string): Promise<string> {
  const html = await requestText(`${WIKIPEDIA_HOST}/api/rest_v1/page/html/${encodeURIComponent(title)}`);
  const { parseHTML } = await import("linkedom");
  const { document } = parseHTML(html);
  const { Readability } = await import("@mozilla/readability");
  const article = new Readability<string>(document as never).parse();
  if (article === null || article.content === null || article.content === undefined) {
    throw new Error(`Wikipedia page is not readable: ${title}`);
  }
  const { default: TurndownService } = await import("turndown");
  const markdown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  }).turndown(article.content);
  const heading = article.title === undefined || article.title === null ? title : article.title;
  return `# ${heading}\n\n${markdown.trim()}\n`;
}

export function wikiTools(): ToolDefinition[] {
  const wikiSearch = defineTool({
    name: "wiki_search",
    label: "Search Wikipedia",
    description: "Search English Wikipedia titles, descriptions, and short excerpts.",
    parameters: Type.Object({
      query: Type.String({ minLength: 1 }),
      limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 50 })),
    }),
    async execute(_toolCallId, params) {
      try {
        const query = new URLSearchParams({ q: params.query, limit: String(params.limit ?? 10) });
        const payload = await requestJson(`${WIKIPEDIA_HOST}/w/rest.php/v1/search/page?${query}`);
        if (typeof payload !== "object" || payload === null || !Array.isArray((payload as { pages?: unknown }).pages)) {
          throw new Error("Wikipedia returned an invalid search response");
        }
        const pages = (payload as { pages: WikiSearchResult[] }).pages;
        return result(
          `found ${pages.length} Wikipedia results`,
          truncateBytes(searchMarkdown(params.query, pages), MAX_MARKDOWN_BYTES),
        );
      } catch (error) {
        return errorResult(error);
      }
    },
  });

  const wikiRead = defineTool({
    name: "wiki_read",
    label: "Read Wikipedia page",
    description: "Read an English Wikipedia page as markdown.",
    parameters: Type.Object({ title: Type.String({ minLength: 1 }) }),
    async execute(_toolCallId, params) {
      try {
        const markdown = await readMarkdown(params.title);
        return result(`read Wikipedia page ${params.title}`, truncateBytes(markdown, MAX_MARKDOWN_BYTES));
      } catch (error) {
        return errorResult(error);
      }
    },
  });

  return [wikiSearch, wikiRead];
}
