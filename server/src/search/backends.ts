import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { appendCacheLog, readCacheLog } from "../agent/cache-log.js";
import { publicErrorReason } from "../ingest/error-reason.js";
import { normalizeUrl } from "../ingest/ids.js";
import { collectImages, type SourceImage } from "../ingest/images.js";
import { MIN_PARSE_QUALITY, scoreParseQuality } from "../ingest/quality.js";
import { assertPublicUrl, isBlockedAddress, isBlockedHostname } from "../ingest/safe-fetch.js";
import { ExaBudget } from "./budget.js";
import {
  buildExaOptions,
  type ExaCategory,
  keywordQuery,
  type SearchContext,
  searchConfig,
  withPlanContext,
} from "./options.js";
import { type PapersTools, papersAdapter } from "./papers.js";

export type SearchBackend = "exa" | "searxng" | "papers";
export type SearchSlot = "foundation" | "explainer" | "primary" | "expert" | "paper" | "video" | "recent";
export interface SearchRequest extends SearchContext {
  concept?: string;
  historical?: boolean;
  userLocation?: string;
  purpose?: "scout" | "verify" | "hard-gap";
  exaOptions?: ReturnType<typeof buildExaOptions>;
  query: string;
  slot?: SearchSlot;
  count?: number;
  category?: ExaCategory | "research paper" | "pdf";
  includeDomains?: string[];
  excludeDomains?: string[];
  similarUrl?: string;
  text?: boolean;
}
export interface SearchResult {
  url: string;
  title: string;
  snippet: string;
  publishedDate: string | null;
  backend: SearchBackend;
  engines: string[];
  text?: string;
  highlights?: string[];
  summary?: string;
  images?: SourceImage[];
  quality?: number;
  doi?: string;
  openAccessUrl?: string;
}
export interface SearchResponse {
  results: SearchResult[];
  warnings: string[];
  costUsd: number;
  cached: boolean;
  costReported?: boolean;
}
export interface SearchAdapter {
  name: SearchBackend;
  search(request: SearchRequest, signal?: AbortSignal): Promise<Omit<SearchResponse, "cached">>;
}
const string = (v: unknown) => (typeof v === "string" ? v : "");
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const domainMatches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
export function normalizeSearchResults(rows: unknown, backend: SearchBackend, req: SearchRequest): SearchResult[] {
  if (!Array.isArray(rows)) return [];
  const expanded = rows.flatMap((row) => {
    if (!row || typeof row !== "object") return [];
    const r = row as Record<string, unknown>;
    return [r, ...(Array.isArray(r.subpages) ? r.subpages.slice(0, 5) : [])];
  });
  return expanded
    .flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const r = row as Record<string, unknown>;
      try {
        const url = new URL(string(r.url));
        if (
          !/^https?:$/.test(url.protocol) ||
          url.username ||
          url.password ||
          isBlockedHostname(url.hostname) ||
          isBlockedAddress(url.hostname.replace(/^\[|\]$/g, ""))
        )
          return [];
        if (req.slot === "video" && !isWatchVideo(url.href, string(r.title))) return [];
        const host = url.hostname.toLowerCase();
        if (req.includeDomains?.length && !req.includeDomains.some((d) => domainMatches(host, d))) return [];
        if (req.excludeDomains?.some((d) => domainMatches(host, d))) return [];
        const text = string(r.text).slice(0, 18000);
        const extras = r.extras as { imageLinks?: unknown } | undefined;
        const images = collectImages(
          strings(extras?.imageLinks)
            .map((u) => `![](${u})`)
            .join("\n"),
          url.href,
        );
        const highlights = strings(r.highlights)
          .map((h) => h.slice(0, 1500))
          .slice(0, 5);
        return [
          {
            url: normalizeUrl(url.href),
            title: string(r.title).slice(0, 500),
            snippet: (string(r.content) || strings(r.highlights).join(" ") || text).slice(0, 1500),
            publishedDate: string(r.publishedDate ?? r.published_date) || null,
            backend,
            engines: strings(r.engines),
            ...(string(r.doi) ? { doi: string(r.doi).slice(0, 500) } : {}),
            ...(string(r.openAccessUrl) && /^https?:\/\//.test(string(r.openAccessUrl))
              ? { openAccessUrl: string(r.openAccessUrl) }
              : {}),
            ...(highlights.length ? { highlights } : {}),
            ...(string(r.summary) ? { summary: string(r.summary).slice(0, 6000) } : {}),
            ...(images.length ? { images } : {}),
            ...(text ? { text, quality: scoreParseQuality(text).score } : {}),
          },
        ];
      } catch {
        return [];
      }
    })
    .slice(0, req.count ?? 10);
}
export function exaAdapter(key: string, fetcher = fetch): SearchAdapter {
  return {
    name: "exa",
    async search(req, signal) {
      if (req.similarUrl) await assertPublicUrl(req.similarUrl);
      const response = await fetcher("https://api.exa.ai/search", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key },
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
        body: JSON.stringify({
          query: req.query,
          ...(req.exaOptions ?? buildExaOptions(req)),
        }),
      });
      if (!response.ok) throw new Error(`Exa HTTP ${response.status}`);
      const body = (await response.json()) as { results?: unknown; costDollars?: { total?: number } };
      const cost = parseExaCost(body);
      const hasCost = cost !== null;
      const results: SearchResult[] = [];
      for (const row of normalizeSearchResults(body.results, "exa", req)) {
        if (row.text) {
          try {
            await assertPublicUrl(row.url);
          } catch {
            continue;
          }
        }
        results.push(row);
      }
      return {
        results,
        warnings: hasCost ? [] : ["Exa did not return usable cost information; spend may be incomplete."],
        costUsd: cost ?? 0,
        costReported: hasCost,
      };
    },
  };
}
export function searxngAdapter(endpoint: string, fetcher = fetch): SearchAdapter {
  return {
    name: "searxng",
    async search(req, signal) {
      // Operator-configured service URL may be private; result URLs remain untrusted.
      const url = new URL("search", endpoint.endsWith("/") ? endpoint : `${endpoint}/`);
      url.searchParams.set("q", keywordQuery(req));
      url.searchParams.set("format", "json");
      if (req.slot === "paper") throw new Error("Papers use papers MCP or Exa publication, never SearXNG.");
      if (req.slot === "video") {
        url.searchParams.set("categories", "videos");
        url.searchParams.set("engines", "youtube");
      }
      const response = await fetcher(url, {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`SearXNG HTTP ${response.status}`);
      const body = (await response.json()) as { results?: unknown; unresponsive_engines?: unknown };
      const results = normalizeSearchResults(body.results, "searxng", req);
      const warnings: string[] = [];
      if (Array.isArray(body.unresponsive_engines) && body.unresponsive_engines.length)
        warnings.push("Some SearXNG engines were unavailable.");
      return { results, warnings, costUsd: 0 };
    },
  };
}
export function isWatchVideo(raw: string, title: string): boolean {
  try {
    const url = new URL(raw);
    return (
      /^https?:$/.test(url.protocol) &&
      !url.username &&
      !url.password &&
      ["youtube.com", "www.youtube.com"].includes(url.hostname) &&
      url.pathname === "/watch" &&
      /^[A-Za-z0-9_-]{11}$/.test(url.searchParams.get("v") ?? "") &&
      !!title.trim()
    );
  } catch {
    return false;
  }
}
export function routeBackends(slot: SearchSlot = "explainer"): SearchBackend[] {
  return slot === "paper" ? ["papers", "exa"] : ["exa", "searxng"];
}
export function parseExaCost(body: unknown): number | null {
  const cost = (body as { costDollars?: { total?: unknown } } | null)?.costDollars?.total;
  return typeof cost === "number" && Number.isFinite(cost) && cost >= 0 ? cost : null;
}
/** Discovery usability only; fetching/ranking and registered evidence remain mandatory. */
export function usableSearchResults(results: SearchResult[]): SearchResult[] {
  const seen = new Set<string>();
  return results.filter((row) => {
    try {
      const url = new URL(row.url);
      const canonical = normalizeUrl(url.href);
      if (
        !/^https?:$/.test(url.protocol) ||
        url.username ||
        url.password ||
        !row.title.trim() ||
        !(row.snippet.trim() || row.text?.trim() || isWatchVideo(row.url, row.title)) ||
        (row.quality !== undefined && row.quality < MIN_PARSE_QUALITY) ||
        seen.has(canonical)
      )
        return false;
      seen.add(canonical);
      return true;
    } catch {
      return false;
    }
  });
}
const pace = new Map<SearchBackend, { tail: Promise<void>; last: number }>();
async function paced<T>(name: SearchBackend, signal: AbortSignal | undefined, fn: () => Promise<T>): Promise<T> {
  const state = pace.get(name) ?? { tail: Promise.resolve(), last: 0 };
  pace.set(name, state);
  const previous = state.tail;
  let release!: () => void;
  state.tail = new Promise<void>((r) => {
    release = r;
  });
  await previous;
  try {
    signal?.throwIfAborted();
    const wait = (name === "searxng" ? 1500 : 150) - (Date.now() - state.last);
    if (wait > 0) await delay(wait, undefined, { signal });
    state.last = Date.now();
    return await fn();
  } finally {
    release();
  }
}
export class SearchService {
  readonly #images = new Map<string, SourceImage[]>();
  imagesFor(url: string): SourceImage[] {
    return this.#images.get(normalizeUrl(url)) ?? [];
  }

  readonly #pendingScouts = new Map<
    string,
    { req: SearchRequest; urls: Set<string>; threshold: number; fallback?: SearchBackend }
  >();
  readonly #failedScouts = new Set<string>();
  readonly #budget: ExaBudget;
  readonly #failures = new Map<SearchBackend, number>();
  readonly #memory = new Map<string, { expires: number; response: SearchResponse }>();
  constructor(
    readonly root: string,
    readonly adapters: SearchAdapter[],
    readonly onUsage?: (requests: number, costUsd: number) => void,
    readonly context: SearchContext = {},
  ) {
    this.#budget = new ExaBudget(root);
  }
  async backend(name: SearchBackend, req: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
    req = await withPlanContext(this.root, { ...this.context, ...req });
    if (req.slot === "video") req = { ...req, includeDomains: ["youtube.com"] };
    if (
      !req.query.trim() ||
      req.query.length > 2000 ||
      (req.count ?? 10) < 1 ||
      !Number.isInteger(req.count ?? 10) ||
      (req.count ?? 10) > 100
    )
      throw new Error("Invalid search request");
    const adapter = this.adapters.find((a) => a.name === name);
    if (!adapter) throw new Error(`${name} is not configured`);
    if (req.similarUrl) await assertPublicUrl(req.similarUrl);
    if (name === "exa") {
      const status = await this.#budget.status();
      if (status.status === "stopped") await this.#budget.run(async () => ({ costUsd: 0 }));
      if (status.status === "unavailable") throw new Error("Exa budget stopped or unavailable.");
    }
    if ((this.#failures.get(name) ?? 0) >= 3) throw new Error(`${name} loop guard: three consecutive failures`);
    if (name === "exa")
      req = {
        ...req,
        exaOptions: buildExaOptions(
          req,
          await searchConfig(this.root),
          new Date(),
          this.#failedScouts.has(req.concept || req.query),
        ),
      };
    // A moving publication end time must not defeat the ordinary 15-minute cache.
    const cacheRequest = req.exaOptions
      ? { ...req, exaOptions: { ...req.exaOptions, endPublishedDate: req.exaOptions.endPublishedDate?.slice(0, 10) } }
      : req;
    const key = createHash("sha256")
      .update(JSON.stringify([name, cacheRequest]))
      .digest("hex");
    const remembered = this.#memory.get(key);
    if (req.exaOptions?.contents.maxAgeHours !== 0 && remembered && remembered.expires > Date.now())
      return { ...remembered.response, cached: true };
    for (const line of (await readCacheLog(this.root, "search-queries.jsonl")).reverse()) {
      try {
        const row = JSON.parse(line);
        if (
          req.exaOptions?.contents.maxAgeHours !== 0 &&
          row.key === key &&
          row.expires > Date.now() &&
          Array.isArray(row.response?.results)
        )
          return { ...row.response, costUsd: 0, cached: true };
      } catch {
        /* Ignore damaged disposable entries. */
      }
    }
    try {
      const call = () =>
        paced(name, signal, async () => {
          if (name === "exa") this.onUsage?.(1, 0);
          const response = await adapter.search(req, signal);
          if (req.slot === "video")
            response.results = response.results.filter((row) => isWatchVideo(row.url, row.title));
          if (name === "exa") this.onUsage?.(0, response.costUsd);
          return response;
        });
      const response = name === "exa" ? await this.#budget.run(call) : await call();
      this.#failures.set(name, 0);
      if (name === "exa" && (await this.#budget.status()).status === "warning")
        response.warnings.push("Exa is near its monthly budget limit.");
      const result = { ...response, cached: false };
      this.#memory.set(key, { expires: Date.now() + 15 * 60000, response: { ...result, costUsd: 0 } });
      await appendCacheLog(this.root, "search-queries.jsonl", {
        key,
        expires: Date.now() + 15 * 60000,
        response: { ...result, costUsd: 0 },
      });
      return result;
    } catch (e) {
      this.#failures.set(name, (this.#failures.get(name) ?? 0) + 1);
      throw e;
    }
  }
  /** Refine the discovery threshold with the scout's actual rank/fetch outcome. */
  async fallbackAfterScout(
    candidates: string[],
    selected: string[],
    signal?: AbortSignal,
  ): Promise<SearchResponse | null> {
    const results: SearchResult[] = [],
      warnings: string[] = [];
    let requested = false,
      cached = true;
    let costUsd = 0;
    const candidateUrls = new Set(candidates.map(normalizeUrl));
    const selectedUrls = new Set(selected.map(normalizeUrl));
    for (const [concept, pending] of this.#pendingScouts) {
      if (![...pending.urls].some((url) => candidateUrls.has(url))) continue;
      this.#pendingScouts.delete(concept);
      if ([...pending.urls].filter((url) => selectedUrls.has(url)).length >= pending.threshold) continue;
      this.#failedScouts.add(pending.req.concept || pending.req.query);
      if (!pending.fallback || !this.adapters.some((a) => a.name === pending.fallback)) continue;
      requested = true;
      try {
        const response = await this.backend(pending.fallback, pending.req, signal);
        costUsd += response.costUsd;
        results.push(...response.results);
        for (const row of response.results) if (row.images?.length) this.#images.set(normalizeUrl(row.url), row.images);
        warnings.push(...response.warnings);
        cached &&= response.cached;
      } catch (e) {
        signal?.throwIfAborted();
        warnings.push(publicErrorReason(e));
      }
    }
    return requested
      ? {
          results: results.filter((r, i, all) => all.findIndex((other) => other.url === r.url) === i),
          warnings,
          costUsd,
          cached,
        }
      : null;
  }
  async search(req: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
    const results: SearchResult[] = [],
      warnings: string[] = [],
      seen = new Set<string>();
    let costUsd = 0,
      cached = true;
    req = await withPlanContext(this.root, { ...this.context, ...req });
    if (req.slot === "video") req = { ...req, includeDomains: ["youtube.com"] };
    const config = await searchConfig(this.root);
    const threshold = Math.min(req.count ?? 10, config.exa.fallbackMinResults);
    for (const name of routeBackends(req.slot)) {
      if (!this.adapters.some((a) => a.name === name)) continue;
      try {
        const r = await this.backend(name, req, signal);
        costUsd += r.costUsd;
        cached &&= r.cached;
        warnings.push(...r.warnings);
        for (const row of r.results)
          if (!seen.has(normalizeUrl(row.url))) {
            seen.add(normalizeUrl(row.url));
            results.push({ ...row, url: normalizeUrl(row.url) });
            if (row.images?.length) this.#images.set(normalizeUrl(row.url), row.images);
          }
        if (usableSearchResults(results).length >= threshold) {
          this.#pendingScouts.set(`${req.slot ?? "explainer"}:${req.concept || req.query}`, {
            req,
            threshold,
            fallback: routeBackends(req.slot)[routeBackends(req.slot).indexOf(name) + 1],
            urls: new Set(results.map((r) => normalizeUrl(r.url))),
          });
          break;
        }
      } catch (error) {
        signal?.throwIfAborted();
        warnings.push(publicErrorReason(error));
      }
    }
    if (req.purpose !== "hard-gap" && usableSearchResults(results).length < threshold)
      this.#failedScouts.add(req.concept || req.query);
    return { results, warnings, costUsd, cached };
  }
}
export function configuredSearch(
  root: string,
  onUsage?: (requests: number, costUsd: number) => void,
  context: SearchContext = {},
  papers?: PapersTools,
): SearchService {
  return new SearchService(
    root,
    [
      ...(papers ? [papersAdapter(papers)] : []),
      ...(process.env.EXA_API_KEY ? [exaAdapter(process.env.EXA_API_KEY)] : []),
      ...(process.env.SEARXNG_URL ? [searxngAdapter(process.env.SEARXNG_URL)] : []),
    ],
    onUsage,
    context,
  );
}
