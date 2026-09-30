import {
  assertPublicUrl,
  decodeBody,
  readCappedResponse,
  SAFE_FETCH_MAX_BYTES,
  SAFE_FETCH_TIMEOUT_MS,
} from "./safe-fetch.js";

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
    url?: unknown;
    metadata?: { title?: unknown; sourceURL?: unknown; url?: unknown };
  };
}

// Firecrawl pages can take a while (JS rendering), so allow more than a plain fetch.
const FIRECRAWL_TIMEOUT_MS = Math.max(SAFE_FETCH_TIMEOUT_MS, 60_000);

/**
 * The v2 scrape endpoint for a configured base URL. Accepts a bare host
 * (`http://127.0.0.1:3002`), a versioned base (`…/v1`, `…/v2`), or a full
 * `…/scrape` URL, so older `.env` values keep working.
 */
export function firecrawlScrapeEndpoint(baseUrl: string): string {
  const trimmed = baseUrl
    .trim()
    .replace(/\/+$/, "")
    .replace(/\/v[12](\/scrape)?$/, "");
  return `${trimmed}/v2/scrape`;
}

/**
 * Scrape a URL to markdown with a (self-hosted or cloud) Firecrawl instance (v2 API).
 *
 * The Firecrawl endpoint is operator configuration, so it may live on localhost or
 * the LAN; it is called with a plain fetch plus timeout and size cap. The page being
 * scraped is still checked with {@link assertPublicUrl}: Firecrawl fetches whatever it
 * is given, so it must never be pointed at internal addresses on our behalf.
 */
export async function firecrawlScrape(url: string, options: FirecrawlOptions): Promise<FirecrawlResult> {
  await assertPublicUrl(url);
  const endpoint = firecrawlScrapeEndpoint(options.baseUrl);
  const headers: Record<string, string> = { accept: "application/json", "content-type": "application/json" };
  if (options.apiKey !== undefined && options.apiKey !== "") {
    headers.authorization = `Bearer ${options.apiKey}`;
  }

  const timeout = AbortSignal.timeout(options.timeoutMs ?? FIRECRAWL_TIMEOUT_MS);
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout;
  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({ url, formats: ["markdown"], onlyMainContent: true }),
      redirect: "error",
      signal,
    });
  } catch (cause) {
    throw new FirecrawlError(`Firecrawl request failed for ${url}`, { cause });
  }
  const bytes = await readCappedResponse(response, SAFE_FETCH_MAX_BYTES, endpoint);

  let payload: unknown;
  try {
    payload = JSON.parse(decodeBody(bytes, response.headers.get("content-type")));
  } catch (cause) {
    throw new FirecrawlError(`Firecrawl returned invalid JSON for ${url} (HTTP ${response.status})`, { cause });
  }

  const root = payload as FirecrawlPayload;
  if (!response.ok || root.success === false) {
    throw new FirecrawlError(`Firecrawl scrape failed: ${root.error ?? `HTTP ${response.status}`}`);
  }
  const markdown = root.data?.markdown;
  if (typeof markdown !== "string" || markdown.trim() === "") {
    throw new FirecrawlError(`Firecrawl returned no markdown for ${url}`);
  }
  const metadata = root.data?.metadata;
  const finalUrl = [metadata?.sourceURL, metadata?.url, root.data?.url].find((value) => typeof value === "string");

  return {
    markdown,
    title: typeof metadata?.title === "string" ? metadata.title : null,
    url: typeof finalUrl === "string" ? finalUrl : url,
  };
}
