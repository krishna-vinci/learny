import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { firecrawlScrape } from "../../ingest/firecrawl.js";
import { assertPublicUrl, decodeBody, safeFetch } from "../../ingest/safe-fetch.js";

const DOWNLOAD_TIMEOUT_MS = 15_000;
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const MAX_MARKDOWN_BYTES = 200 * 1024;

interface ToolDetails {
  isError: boolean;
  summary: string;
}

export interface WebFetchOptions {
  firecrawlUrl?: string;
  firecrawlKey?: string;
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

function truncateBytes(text: string, maxBytes: number): string {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) return text;
  let length = Math.floor((text.length * maxBytes) / bytes);
  while (length > 0 && Buffer.byteLength(text.slice(0, length), "utf8") > maxBytes) length--;
  return `${text.slice(0, length)}\n\n[Truncated at 200 KB]`;
}

async function htmlToMarkdown(html: string, fallbackUrl: URL): Promise<string> {
  const { parseHTML } = await import("linkedom");
  const { document } = parseHTML(html);
  const { Readability } = await import("@mozilla/readability");
  const article = new Readability<string>(document as never).parse();
  const { default: TurndownService } = await import("turndown");
  const turndown = new TurndownService({
    headingStyle: "atx",
    bulletListMarker: "-",
    codeBlockStyle: "fenced",
  });
  if (article !== null && article.content !== null && article.content !== undefined) {
    const title = article.title ?? fallbackUrl.hostname;
    return `# ${title}\n\n${turndown.turndown(article.content).trim()}\n`;
  }

  const bodyText = document.body?.textContent?.trim() ?? "";
  if (bodyText === "") throw new Error("Page contains no readable text");
  return `${turndown.turndown(html).trim()}\n`;
}

async function firecrawlMarkdown(url: URL, opts: WebFetchOptions): Promise<string | null> {
  if (opts.firecrawlUrl === undefined || opts.firecrawlUrl === "") return null;
  try {
    const scraped = await firecrawlScrape(url.toString(), {
      baseUrl: opts.firecrawlUrl,
      ...(opts.firecrawlKey === undefined ? {} : { apiKey: opts.firecrawlKey }),
    });
    return scraped.markdown;
  } catch {
    return null;
  }
}

export function webFetchTool(opts: WebFetchOptions = {}): ToolDefinition {
  return defineTool({
    name: "web_fetch",
    label: "Fetch web page",
    description: "Fetch a public http(s) page and return readable markdown.",
    parameters: Type.Object({ url: Type.String({ minLength: 1 }) }),
    async execute(_toolCallId, params) {
      try {
        // Validate before Firecrawl too, so both paths share one SSRF guard.
        const url = await assertPublicUrl(params.url);
        const firecrawl = await firecrawlMarkdown(url, opts);
        if (firecrawl !== null) {
          return result(`fetched ${url.hostname} with Firecrawl`, truncateBytes(firecrawl, MAX_MARKDOWN_BYTES));
        }
        const response = await safeFetch(url.toString(), {
          headers: { accept: "text/html,application/xhtml+xml,text/plain;q=0.9", "user-agent": "Studium/0.0" },
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
          maxBytes: MAX_DOWNLOAD_BYTES,
        });
        const markdown = await htmlToMarkdown(decodeBody(response.bytes, response.contentType), url);
        return result(`fetched ${url.hostname}`, truncateBytes(markdown, MAX_MARKDOWN_BYTES));
      } catch (error) {
        return errorResult(error);
      }
    },
  });
}
