import { createHash } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { appendCacheLog, readCacheLog } from "../agent/cache-log.js";
import { publicErrorReason } from "../ingest/error-reason.js";
import { normalizeUrl } from "../ingest/ids.js";
import { scoreParseQuality } from "../ingest/quality.js";
import { assertPublicUrl } from "../ingest/safe-fetch.js";

export type SearchBackend = "exa" | "searxng";
export type SearchSlot = "foundation" | "explainer" | "primary" | "expert" | "paper" | "video" | "recent";
export interface SearchRequest {
  query: string;
  slot?: SearchSlot;
  count?: number;
  category?: "research paper" | "pdf";
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
  quality?: number;
}
export interface SearchResponse {
  results: SearchResult[];
  warnings: string[];
  costUsd: number;
  cached: boolean;
}
export interface SearchAdapter {
  name: SearchBackend;
  search(request: SearchRequest, signal?: AbortSignal): Promise<Omit<SearchResponse, "cached">>;
}
const string = (v: unknown) => (typeof v === "string" ? v : "");
const strings = (v: unknown) => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);
const domainMatches = (host: string, domain: string) => host === domain || host.endsWith(`.${domain}`);
function normalize(rows: unknown, backend: SearchBackend, req: SearchRequest): SearchResult[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const r = row as Record<string, unknown>;
      try {
        const url = new URL(string(r.url));
        if (!/^https?:$/.test(url.protocol) || url.username || url.password) return [];
        const host = url.hostname.toLowerCase();
        if (req.includeDomains?.length && !req.includeDomains.some((d) => domainMatches(host, d))) return [];
        if (req.excludeDomains?.some((d) => domainMatches(host, d))) return [];
        const text = string(r.text).slice(0, 18000);
        return [
          {
            url: normalizeUrl(url.href),
            title: string(r.title).slice(0, 500),
            snippet: (string(r.content) || strings(r.highlights).join(" ") || text).slice(0, 1500),
            publishedDate: string(r.publishedDate ?? r.published_date) || null,
            backend,
            engines: strings(r.engines),
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
      const response = await fetcher(`https://api.exa.ai/${req.similarUrl ? "findSimilar" : "search"}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": key },
        redirect: "error",
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
        body: JSON.stringify({
          ...(req.similarUrl ? { url: req.similarUrl } : { query: req.query, type: "auto" }),
          numResults: req.count ?? 10,
          ...(req.category ? { category: req.category === "research paper" ? "publication" : req.category } : {}),
          ...(req.includeDomains?.length ? { includeDomains: req.includeDomains } : {}),
          ...(req.excludeDomains?.length ? { excludeDomains: req.excludeDomains } : {}),
          contents: { highlights: true, ...(req.text ? { text: { maxCharacters: 18000 } } : {}) },
        }),
      });
      if (!response.ok) throw new Error(`Exa HTTP ${response.status}`);
      const body = (await response.json()) as { results?: unknown; costDollars?: { total?: number } };
      const cost = body.costDollars?.total;
      const hasCost = typeof cost === "number" && Number.isFinite(cost) && cost >= 0;
      const results: SearchResult[] = [];
      for (const row of normalize(body.results, "exa", req)) {
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
        costUsd: hasCost ? cost : 0,
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
      url.searchParams.set("q", req.query);
      url.searchParams.set("format", "json");
      const requested =
        req.slot === "paper"
          ? ["arxiv", "crossref", "pubmed", "semantic scholar", "openalex", "google scholar", "openaire"]
          : [];
      if (requested.length) url.searchParams.set("engines", requested.join(","));
      if (req.slot === "video") url.searchParams.set("categories", "videos");
      const response = await fetcher(url, {
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000),
      });
      if (!response.ok) throw new Error(`SearXNG HTTP ${response.status}`);
      const body = (await response.json()) as { results?: unknown; unresponsive_engines?: unknown };
      let results = normalize(body.results, "searxng", req);
      const warnings: string[] = [];
      if (requested.length) {
        const valid = results.filter((r) => r.engines.some((e) => requested.includes(e)));
        if (valid.length !== results.length || !valid.length)
          warnings.push("Science engines did not answer all results; default-engine fallbacks discarded.");
        results = valid;
      }
      if (Array.isArray(body.unresponsive_engines) && body.unresponsive_engines.length)
        warnings.push("Some SearXNG engines were unavailable.");
      return { results, warnings, costUsd: 0 };
    },
  };
}
export function routeBackends(slot: SearchSlot = "explainer"): SearchBackend[] {
  return slot === "video" || slot === "recent"
    ? ["searxng"]
    : slot === "paper"
      ? ["searxng", "exa"]
      : ["exa", "searxng"];
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
  readonly #failures = new Map<SearchBackend, number>();
  readonly #memory = new Map<string, { expires: number; response: SearchResponse }>();
  constructor(
    readonly root: string,
    readonly adapters: SearchAdapter[],
    readonly onUsage?: (requests: number, costUsd: number) => void,
  ) {}
  async backend(name: SearchBackend, req: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
    if (!req.query.trim() || req.query.length > 2000 || (req.count ?? 10) < 1 || (req.count ?? 10) > 20)
      throw new Error("Invalid search request");
    const adapter = this.adapters.find((a) => a.name === name);
    if (!adapter) throw new Error(`${name} is not configured`);
    if (req.similarUrl) await assertPublicUrl(req.similarUrl);
    if ((this.#failures.get(name) ?? 0) >= 3) throw new Error(`${name} loop guard: three consecutive failures`);
    const key = createHash("sha256")
      .update(JSON.stringify([name, req]))
      .digest("hex");
    const remembered = this.#memory.get(key);
    if (remembered && remembered.expires > Date.now()) return { ...remembered.response, cached: true };
    for (const line of (await readCacheLog(this.root, "search-queries.jsonl")).reverse()) {
      try {
        const row = JSON.parse(line);
        if (row.key === key && row.expires > Date.now() && Array.isArray(row.response?.results))
          return { ...row.response, costUsd: 0, cached: true };
      } catch {
        /* Ignore damaged disposable entries. */
      }
    }
    try {
      const response = await paced(name, signal, async () => {
        if (name === "exa") this.onUsage?.(1, 0);
        return adapter.search(req, signal);
      });
      if (name === "exa") this.onUsage?.(0, response.costUsd);
      this.#failures.set(name, 0);
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
  async search(req: SearchRequest, signal?: AbortSignal): Promise<SearchResponse> {
    const results: SearchResult[] = [],
      warnings: string[] = [],
      seen = new Set<string>();
    let costUsd = 0,
      cached = true;
    for (const name of routeBackends(req.slot)) {
      if (!this.adapters.some((a) => a.name === name)) continue;
      try {
        const r = await this.backend(
          name,
          { ...req, ...(req.slot === "paper" ? { category: "research paper" } : {}) },
          signal,
        );
        costUsd += r.costUsd;
        cached &&= r.cached;
        warnings.push(...r.warnings);
        for (const row of r.results)
          if (!seen.has(row.url)) {
            seen.add(row.url);
            results.push(row);
          }
      } catch (error) {
        signal?.throwIfAborted();
        warnings.push(publicErrorReason(error));
      }
    }
    return { results, warnings, costUsd, cached };
  }
}
export function configuredSearch(root: string, onUsage?: (requests: number, costUsd: number) => void): SearchService {
  return new SearchService(
    root,
    [
      ...(process.env.EXA_API_KEY ? [exaAdapter(process.env.EXA_API_KEY)] : []),
      ...(process.env.SEARXNG_URL ? [searxngAdapter(process.env.SEARXNG_URL)] : []),
    ],
    onUsage,
  );
}
