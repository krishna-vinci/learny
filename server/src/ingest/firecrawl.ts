import type { SiteMapPage } from "@studium/shared";
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
  includeHtml?: boolean;
  waitFor?: number;
}

export interface FirecrawlResult {
  markdown: string;
  html?: string;
  title: string | null;
  url: string | null;
}

export interface FirecrawlMapOptions extends FirecrawlOptions {
  search?: string;
  limit?: number;
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
  links?: unknown;
  data?: {
    markdown?: unknown;
    html?: unknown;
    rawHtml?: unknown;
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
    .replace(/\/v[12](\/(?:scrape|map))?$/, "");
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
  const root = await firecrawlRequest(
    url,
    "scrape",
    {
      url,
      formats: options.includeHtml ? ["markdown", "html"] : ["markdown"],
      onlyMainContent: true,
      ...(options.waitFor ? { waitFor: options.waitFor } : {}),
    },
    options,
  );
  const markdown = root.data?.markdown;
  if (typeof markdown !== "string" || markdown.trim() === "") {
    throw new FirecrawlError(`Firecrawl returned no markdown for ${url}`);
  }
  const metadata = root.data?.metadata;
  const finalUrl = [metadata?.sourceURL, metadata?.url, root.data?.url].find((value) => typeof value === "string");

  // Check every supplied final URL, including aliases hidden by sourceURL precedence.
  for (const value of [metadata?.sourceURL, metadata?.url, root.data?.url]) {
    if (value === undefined || value === null) continue;
    if (typeof value !== "string") throw new FirecrawlError("Firecrawl returned an invalid final URL");
    await assertPublicUrl(value);
  }
  return {
    markdown,
    ...(typeof root.data?.html === "string"
      ? { html: root.data.html }
      : typeof root.data?.rawHtml === "string"
        ? { html: root.data.rawHtml }
        : {}),
    title: typeof metadata?.title === "string" ? metadata.title : null,
    url: typeof finalUrl === "string" ? finalUrl : url,
  };
}

/** Map a public site; retain only its normalized hostname and child subdomains. */
export async function firecrawlMap(url: string, options: FirecrawlMapOptions): Promise<SiteMapPage[]> {
  const site = await assertPublicUrl(url);
  const limit = options.limit ?? 100;
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) {
    throw new FirecrawlError("Firecrawl map limit must be an integer from 1 to 500");
  }
  const root = await firecrawlRequest(
    url,
    "map",
    {
      url,
      ...(options.search === undefined ? {} : { search: options.search }),
      limit,
      includeSubdomains: false,
      ignoreQueryParameters: true,
    },
    options,
  );
  if (!Array.isArray(root.links)) throw new FirecrawlError(`Firecrawl returned no links array for ${url}`);

  const host = normalizedHostname(site);
  const pages: SiteMapPage[] = [];
  for (const link of root.links.slice(0, limit)) {
    options.signal?.throwIfAborted();
    const page = typeof link === "string" ? { url: link } : link;
    if (typeof page !== "object" || page === null || typeof page.url !== "string") continue;
    try {
      const candidate = new URL(page.url);
      const candidateHost = normalizedHostname(candidate);
      // Off-site links are dropped before any DNS lookup.
      if (candidateHost !== host && !candidateHost.endsWith(`.${host}`)) continue;
    } catch {
      continue;
    }
    // A returned on-site destination that fails the public-URL boundary rejects the response.
    await assertPublicUrl(page.url);
    pages.push({
      url: page.url,
      ...(typeof page.title === "string" ? { title: page.title } : {}),
      ...(typeof page.description === "string" ? { description: page.description } : {}),
    });
  }
  return pages;
}

function normalizedHostname(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

/** The configured service is trusted, but redirects, duration and response size are bounded. */
async function firecrawlRequest(
  url: string,
  action: "scrape" | "map",
  body: Record<string, unknown>,
  options: FirecrawlOptions,
): Promise<FirecrawlPayload> {
  const endpoint = firecrawlScrapeEndpoint(options.baseUrl).replace(/\/scrape$/, `/${action}`);
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
      body: JSON.stringify(body),
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

  if (typeof payload !== "object" || payload === null || Array.isArray(payload)) {
    throw new FirecrawlError(`Firecrawl returned an invalid response for ${url}`);
  }
  const root = payload as FirecrawlPayload;
  if (!response.ok || root.success === false) {
    throw new FirecrawlError(`Firecrawl ${action} failed: ${root.error ?? `HTTP ${response.status}`}`);
  }
  return root;
}
