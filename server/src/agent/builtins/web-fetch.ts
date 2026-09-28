import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { assertPublicUrl, decodeBody, readCappedResponse, safeFetch } from "../../ingest/safe-fetch.js";

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

function withTimeout(controller = new AbortController()): { signal: AbortSignal; stop: () => void } {
  const timer = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
  return {
    signal: controller.signal,
    stop: () => {
      clearTimeout(timer);
      controller.abort();
    },
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

function firecrawlEndpoint(base: string): string {
  const trimmed = base.replace(/\/+$/, "");
  if (trimmed.endsWith("/scrape")) return trimmed;
  return trimmed.endsWith("/v1") ? `${trimmed}/scrape` : `${trimmed}/v1/scrape`;
}

async function firecrawlMarkdown(url: URL, opts: WebFetchOptions): Promise<string | null> {
  if (opts.firecrawlUrl === undefined) return null;
  const { signal, stop } = withTimeout();
  try {
    const response = await fetch(firecrawlEndpoint(opts.firecrawlUrl), {
      method: "POST",
      signal,
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        ...(opts.firecrawlKey === undefined ? {} : { authorization: `Bearer ${opts.firecrawlKey}` }),
      },
      body: JSON.stringify({ url: url.toString(), formats: ["markdown"] }),
    });
    const bytes = await readCappedResponse(response, MAX_DOWNLOAD_BYTES, firecrawlEndpoint(opts.firecrawlUrl));
    if (!response.ok) return null;
    const payload: unknown = JSON.parse(decodeBody(bytes, response.headers.get("content-type")));
    if (typeof payload !== "object" || payload === null) return null;
    const data = (payload as { data?: unknown }).data;
    if (typeof data !== "object" || data === null) return null;
    const markdown = (data as { markdown?: unknown }).markdown;
    return typeof markdown === "string" && markdown.trim() !== "" ? markdown : null;
  } catch {
    return null;
  } finally {
    stop();
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
