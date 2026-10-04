import { defineTool, type ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { publicErrorReason } from "../../ingest/error-reason.js";
import { firecrawlScrape } from "../../ingest/firecrawl.js";
import { paywallHint, politeFetch } from "../../ingest/polite-fetch.js";
import { assertPublicUrl, decodeBody } from "../../ingest/safe-fetch.js";
import { htmlToMarkdown as convertHtml } from "../../ingest/web.js";

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
  blockedHosts?: Map<string, string>;
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

export function webFetchTool(opts: WebFetchOptions = {}): ToolDefinition {
  // Tool instance lives for a job/chat; never share the blocklist between learners.
  const blocked = opts.blockedHosts ?? new Map<string, string>();
  return defineTool({
    name: "web_fetch",
    label: "Fetch web page",
    description: "Fetch a public http(s) page and return readable markdown.",
    parameters: Type.Object({ url: Type.String({ minLength: 1 }) }),
    async execute(_toolCallId, params, signal) {
      let firecrawlError: string | null = null;
      let currentUrl: URL | null = null;
      try {
        // Validate before Firecrawl too, so both paths share one SSRF guard.
        const url = await assertPublicUrl(params.url);
        currentUrl = url;
        const previous = blocked.get(url.hostname);
        if (previous) throw new Error(`Host blocked earlier in this job/chat: ${previous}`);
        if (opts.firecrawlUrl) {
          try {
            const scraped = await firecrawlScrape(url.toString(), {
              baseUrl: opts.firecrawlUrl,
              apiKey: opts.firecrawlKey,
              signal,
              includeHtml: true,
            });
            return result(
              `fetched ${url.hostname} with Firecrawl`,
              truncateBytes(
                scraped.html ? convertHtml(scraped.html, scraped.url ?? url.toString()).markdown : scraped.markdown,
                MAX_MARKDOWN_BYTES,
              ),
            );
          } catch (error) {
            firecrawlError = publicErrorReason(error);
          }
        }
        const response = await politeFetch(url.toString(), {
          headers: { accept: "text/html,application/xhtml+xml,text/plain;q=0.9", "user-agent": "Studium/0.0" },
          timeoutMs: DOWNLOAD_TIMEOUT_MS,
          maxBytes: MAX_DOWNLOAD_BYTES,
          signal,
        });
        const markdown = convertHtml(decodeBody(response.bytes, response.contentType), response.url).markdown;
        return result(
          `fetched ${url.hostname}`,
          truncateBytes(
            `${firecrawlError ? `Firecrawl failed: ${firecrawlError}\n\n` : ""}${markdown}`,
            MAX_MARKDOWN_BYTES,
          ),
        );
      } catch (error) {
        const direct = publicErrorReason(error);
        if (currentUrl && /HTTP (?:401|403|451)\b/.test(direct)) blocked.set(currentUrl.hostname, direct);
        return errorResult(
          `${firecrawlError ? `Firecrawl failed: ${firecrawlError}; direct: ` : ""}${direct}${currentUrl ? paywallHint(currentUrl) : ""}`,
        );
      }
    },
  });
}
