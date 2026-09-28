import { decodeBody, safeFetch } from "./safe-fetch.js";

export interface FirecrawlOptions {
  baseUrl: string;
  apiKey?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface FirecrawlResult {
  markdown: string;
  title: string | null;
  url: string | null;
}

export class FirecrawlError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FirecrawlError";
  }
}

interface FirecrawlPayload {
  success?: boolean;
  error?: string;
  data?: {
    markdown?: unknown;
    content?: unknown;
    url?: unknown;
    metadata?: { title?: unknown };
  };
}

/**
 * Scrape a URL to markdown with a (self-hosted or cloud) Firecrawl instance.
 * Used for web pages that readability cannot clean well; the caller falls back
 * to the built-in extractor when this fails.
 */
export async function firecrawlScrape(url: string, options: FirecrawlOptions): Promise<FirecrawlResult> {
  const base = options.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (options.apiKey !== undefined && options.apiKey !== "") {
    headers.authorization = `Bearer ${options.apiKey}`;
  }

  const response = await safeFetch(`${base}/v1/scrape`, {
    method: "POST",
    headers,
    body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
    signal: options.signal,
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
  });

  let payload: unknown;
  try {
    payload = JSON.parse(decodeBody(response.bytes, response.contentType));
  } catch (cause) {
    throw new FirecrawlError(`Firecrawl returned invalid JSON for ${url}`, { cause });
  }

  const root = payload as FirecrawlPayload;
  if (root.success === false) {
    throw new FirecrawlError(`Firecrawl scrape failed: ${root.error ?? "unknown error"}`);
  }
  const markdown = typeof root.data?.markdown === "string" ? root.data.markdown : root.data?.content;
  if (typeof markdown !== "string" || markdown.trim() === "") {
    throw new FirecrawlError(`Firecrawl returned no markdown for ${url}`);
  }

  return {
    markdown,
    title: typeof root.data?.metadata?.title === "string" ? root.data.metadata.title : null,
    url: typeof root.data?.url === "string" ? root.data.url : url,
  };
}
