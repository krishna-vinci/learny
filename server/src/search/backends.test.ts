import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  exaAdapter,
  parseExaCost,
  routeBackends,
  type SearchBackend,
  SearchService,
  searxngAdapter,
  usableSearchResults,
} from "./backends.js";

vi.mock("node:dns", () => ({ promises: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) } }));
const roots: string[] = [];
async function root() {
  const r = await fs.mkdtemp(path.join(os.tmpdir(), "studium-search-"));
  roots.push(r);
  return r;
}
afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true })));
});
describe("search backends", () => {
  it("normalizes Exa contents, filters domains and records cost without exposing credentials", async () => {
    const fake = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          costDollars: { total: 0.007 },
          results: [
            {
              url: "https://mit.edu/lesson?utm_source=a",
              title: "Lesson",
              text: `# Lesson\n\n${"Learn linear transformations. ".repeat(100)}`,
            },
            { url: "https://seo.test/a" },
          ],
        }),
      ),
    );
    const r = await exaAdapter("fake-secret", fake).search({
      query: "a textbook lesson",
      includeDomains: ["mit.edu"],
      category: "research paper",
      text: true,
    });
    expect(r).toMatchObject({
      costUsd: 0.007,
      results: [{ url: "https://mit.edu/lesson", backend: "exa", quality: expect.any(Number) }],
    });
    expect(r.results).toHaveLength(1);
    expect(JSON.parse(fake.mock.calls[0]?.[1].body)).toMatchObject({
      type: "auto",
      category: "publication",
      contents: { text: { maxCharacters: 18000 } },
    });
    expect(JSON.stringify(r)).not.toContain("fake-secret");
  });
  it("never calls SearXNG for papers", async () => {
    const fetcher = vi.fn();
    await expect(
      searxngAdapter("http://localhost:8080", fetcher).search({ query: "polymers", slot: "paper" }),
    ).rejects.toThrow("never SearXNG");
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("merges canonical duplicates, caches across service instances and charges only real calls", async () => {
    const r = await root(),
      usage = vi.fn();
    const make = (name: "exa" | "searxng") => ({
      name,
      search: vi.fn().mockResolvedValue({
        results: [
          { url: "https://example.org/a", title: "A", snippet: "", publishedDate: null, backend: name, engines: [] },
        ],
        warnings: [],
        costUsd: name === "exa" ? 0.007 : 0,
      }),
    });
    const exa = make("exa"),
      searx = make("searxng");
    const service = new SearchService(r, [exa, searx], usage);
    expect((await service.search({ query: "A", subject: "technology" })).results).toHaveLength(1);
    expect((await new SearchService(r, [exa, searx], usage).search({ query: "A", subject: "technology" })).cached).toBe(
      true,
    );
    expect(exa.search).toHaveBeenCalledTimes(1);
    expect(usage.mock.calls).toEqual([
      [1, 0],
      [0, 0.007],
    ]);
  });
  it("falls back without Exa and guards repeated failures without retry storms", async () => {
    const fallback = vi.fn().mockResolvedValue({ results: [], warnings: [], costUsd: 0 });
    await new SearchService(await root(), [{ name: "searxng", search: fallback }]).search({ query: "fallback" });
    expect(fallback).toHaveBeenCalledTimes(1);
    const search = vi.fn().mockRejectedValue(new Error("HTTP 429"));
    const service = new SearchService(await root(), [{ name: "exa", search }]);
    for (let i = 0; i < 4; i++) await service.search({ query: `query ${i}` });
    expect(search).toHaveBeenCalledTimes(3);
    expect(routeBackends("video")).toEqual(["exa", "searxng"]);
    expect(routeBackends("paper")).toEqual(["papers", "exa"]);
  });
  it("paces SearXNG starts at least 1.5 seconds apart and aborts queued requests", async () => {
    vi.useFakeTimers();
    const starts: number[] = [];
    const service = new SearchService(await root(), [
      {
        name: "searxng",
        async search() {
          starts.push(Date.now());
          return { results: [], warnings: [], costUsd: 0 };
        },
      },
    ]);
    const a = service.search({ query: "first" });
    await vi.advanceTimersByTimeAsync(2000);
    await a;
    const b = service.search({ query: "second" });
    await vi.advanceTimersByTimeAsync(2000);
    await b;
    expect((starts[1] ?? 0) - (starts[0] ?? 0)).toBeGreaterThanOrEqual(1500);
    const controller = new AbortController();
    controller.abort();
    await expect(service.search({ query: "cancel", slot: "recent" }, controller.signal)).rejects.toThrow();
    expect(starts).toHaveLength(2);
  });
});

it("rejects non-public returned page text and unsafe find-similar seeds", async () => {
  const fetcher = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        results: [{ url: "http://127.0.0.1/private", text: "private text" }],
        costDollars: { total: 0.004 },
      }),
    ),
  );
  const backend = exaAdapter("fake-secret", fetcher);
  expect((await backend.search({ query: "pages", text: true })).results).toEqual([]);
  await expect(backend.search({ query: "pages", similarUrl: "http://127.0.0.1/private" })).rejects.toThrow();
  expect(fetcher).toHaveBeenCalledTimes(1);
  const usage = vi.fn();
  const service = new SearchService(await root(), [backend], usage);
  await expect(service.backend("exa", { query: "pages", similarUrl: "http://127.0.0.1/private" })).rejects.toThrow();
  expect(usage).not.toHaveBeenCalled();
});

const lead = (n: number, backend: SearchBackend = "exa") => ({
  url: `https://example.org/${n}`,
  title: `Lesson ${n}`,
  snippet: "Structured teaching source",
  publishedDate: null,
  backend,
  engines: [],
});

it("uses papers MCP first, falls back on thin, unavailable or failed MCP, and never uses SearXNG", async () => {
  const papers = {
    name: "papers" as const,
    search: vi.fn(async () => ({
      results: [lead(1, "papers"), lead(2, "papers"), lead(3, "papers")],
      warnings: [],
      costUsd: 0,
    })),
  };
  const exa = {
    name: "exa" as const,
    search: vi.fn(async (_req: import("./backends.js").SearchRequest) => ({
      results: [lead(1), lead(4), lead(5)],
      warnings: [],
      costUsd: 0.007,
    })),
  };
  const searxng = { name: "searxng" as const, search: vi.fn() };
  const service = new SearchService(await root(), [papers, exa, searxng]);
  await service.search({ query: "adequate", slot: "paper" });
  expect(exa.search).not.toHaveBeenCalled();
  const fallback = await service.fallbackAfterScout([lead(1).url, lead(2).url], [lead(1).url]);
  expect(fallback?.costUsd).toBe(0.007);
  expect(exa.search).toHaveBeenCalledTimes(1);
  papers.search.mockResolvedValueOnce({ results: [lead(1, "papers")], warnings: [], costUsd: 0 });
  expect((await service.search({ query: "thin", slot: "paper" })).results).toHaveLength(3);
  papers.search.mockRejectedValueOnce(new Error("MCP unavailable"));
  await service.search({ query: "failed", slot: "paper" });
  await new SearchService(await root(), [exa, searxng]).search({ query: "absent", slot: "paper" });
  await new SearchService(await root(), [searxng]).search({ query: "all absent", slot: "paper" });
  expect(searxng.search).not.toHaveBeenCalled();
  expect(exa.search).toHaveBeenCalledTimes(4);
  papers.search.mockResolvedValueOnce({ results: [lead(1, "papers")], warnings: [], costUsd: 0 });
  exa.search.mockResolvedValueOnce({ results: [lead(4), lead(5)], warnings: [], costUsd: 0.007 });
  await service.search({ query: "combined threshold", concept: "combined", slot: "paper" });
  expect(await service.fallbackAfterScout([lead(1).url, lead(4).url, lead(5).url], [])).toBeNull();
  papers.search.mockResolvedValueOnce({ results: [], warnings: [], costUsd: 0 });
  await service.search({ query: "explicit combined gap", concept: "combined", slot: "paper", purpose: "hard-gap" });
  expect(exa.search.mock.calls.at(-1)?.[0]?.exaOptions?.type).toBe("deep-lite");
}, 12000);

it("filters video results before counting and falls back to the youtube engine", async () => {
  const rows = [
    {
      url: "https://www.youtube.com/watch?v=abcdefghijk",
      title: "University lecture",
      highlights: ["Teaching eigenvectors"],
      engines: ["youtube"],
    },
    ...[
      "https://youtube.com/shorts/abcdefghijk",
      "https://music.youtube.com/watch?v=abcdefghijk",
      "https://youtube.com/channel/abc",
      "https://youtube.com/playlist?list=abc",
      "https://youtube.com/watch?v=short",
    ].map((url) => ({ url, title: "Invalid", highlights: ["teaching"] })),
    { url: "https://youtube.com/watch?v=zyxwvutsrqp", title: " ", highlights: ["teaching"] },
  ];
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ results: rows, costDollars: { total: 0.007 } })),
  );
  const fallbackFetch = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({ results: rows })));
  const response = await new SearchService(await root(), [
    exaAdapter("fake", fetcher),
    searxngAdapter("http://localhost:8080", fallbackFetch),
  ]).search({ query: "eigenvectors", slot: "video" });
  expect(response.results).toHaveLength(1);
  expect(JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string).includeDomains).toEqual(["youtube.com"]);
  const url = new URL(fallbackFetch.mock.calls[0]?.[0] as string);
  expect(url.searchParams.get("engines")).toBe("youtube");
  expect(url.searchParams.get("q")).toBe("eigenvectors lecture demonstration");
});

it("counts valid watch videos with titles even when snippets are absent", () => {
  expect(
    usableSearchResults([
      { ...lead(1), url: "https://youtube.com/watch?v=abcdefghijk", snippet: "" },
      { ...lead(2), url: "https://youtube.com/shorts/abcdefghijk", snippet: "" },
      { ...lead(3), url: "https://music.youtube.com/watch?v=abcdefghijk", snippet: "" },
      { ...lead(4), url: "https://youtube.com/watch?v=zyxwvutsrqp", title: "", snippet: "" },
    ]),
  ).toHaveLength(1);
});

it("uses search with the supplied seed topic instead of deprecated findSimilar", async () => {
  const fetcher = vi.fn<typeof fetch>(
    async () => new Response(JSON.stringify({ results: [], costDollars: { total: 0.007 } })),
  );
  await exaAdapter("fake", fetcher).search({
    query: "eigenvector intuition",
    similarUrl: "https://example.org/lesson",
  });
  expect(fetcher.mock.calls[0]?.[0]).toBe("https://api.exa.ai/search");
  const body = JSON.parse(fetcher.mock.calls[0]?.[1]?.body as string);
  expect(body).toMatchObject({ query: "eigenvector intuition", type: "fast" });
  expect(body).not.toHaveProperty("url");
});
it("routes ordinary slots to Exa first and skips fallback for enough distinct usable leads", async () => {
  const calls: string[] = [];
  const exa = {
    name: "exa" as const,
    search: vi.fn(async () => {
      calls.push("exa");
      return { results: [lead(1), lead(2), lead(3)], warnings: [], costUsd: 0.007 };
    }),
  };
  const searxng = {
    name: "searxng" as const,
    search: vi.fn(async () => {
      calls.push("searxng");
      return { results: [lead(4, "searxng")], warnings: [], costUsd: 0 };
    }),
  };
  const service = new SearchService(await root(), [exa, searxng]);
  for (const slot of ["foundation", "explainer", "primary", "expert", "recent"] as const) {
    expect(routeBackends(slot)).toEqual(["exa", "searxng"]);
    await service.search({ query: slot, slot });
  }
  expect(searxng.search).not.toHaveBeenCalled();
  expect(calls).toEqual(["exa", "exa", "exa", "exa", "exa"]);
}, 12000);
it("falls back for errors, short usable results, missing configuration and budget stop; canonicalizes the merge", async () => {
  const r = await root();
  const calls: string[] = [];
  const exa = {
    name: "exa" as const,
    search: vi.fn(async () => {
      calls.push("exa");
      return {
        results: [
          lead(1),
          { ...lead(1), url: "https://example.org/1?utm_source=duplicate" },
          { ...lead(2), title: "" },
        ],
        warnings: [],
        costUsd: 0.007,
      };
    }),
  };
  const searxng = {
    name: "searxng" as const,
    search: vi.fn(async () => {
      calls.push("searxng");
      return { results: [lead(1, "searxng"), lead(3, "searxng")], warnings: [], costUsd: 0 };
    }),
  };
  expect((await new SearchService(r, [exa, searxng]).search({ query: "short" })).results.map((r) => r.url)).toEqual([
    "https://example.org/1",
    "https://example.org/2",
    "https://example.org/3",
  ]);
  expect(calls).toEqual(["exa", "searxng"]);
  exa.search.mockRejectedValueOnce(new Error("HTTP 429"));
  await new SearchService(r, [exa, searxng]).search({ query: "error" });
  expect(calls.at(-1)).toBe("searxng");
  await new SearchService(r, [searxng]).search({ query: "missing" });
  await fs.mkdir(path.join(r, "_global"));
  await fs.writeFile(path.join(r, "_global/config.yaml"), "search:\n  exa:\n    stopUsd: 0.007\n");
  const before = exa.search.mock.calls.length;
  const stopped = await new SearchService(r, [exa, searxng]).search({ query: "short" });
  expect(stopped.results.every((r) => r.backend === "searxng")).toBe(true);
  expect(exa.search).toHaveBeenCalledTimes(before);
}, 12000);
it("uses configured thresholds and enables deep-lite only after a failed scout", async () => {
  const r = await root();
  await fs.mkdir(path.join(r, "_global"));
  await fs.writeFile(path.join(r, "_global/config.yaml"), "search:\n  exa:\n    fallbackMinResults: 2\n");
  const search = vi.fn(async (_req: import("./backends.js").SearchRequest) => ({
    results: [lead(1)],
    warnings: [],
    costUsd: 0.007,
  }));
  const service = new SearchService(r, [{ name: "exa", search }]);
  await service.search({ query: "first retry", concept: "chains", purpose: "hard-gap" });
  expect(search.mock.calls[0]?.[0]?.exaOptions?.type).toBe("auto");
  await service.search({ query: "scout", concept: "chains" });
  await service.search({ query: "retry", concept: "chains", purpose: "hard-gap" });
  expect(search.mock.calls[2]?.[0]?.exaOptions?.type).toBe("deep-lite");
});
it("parses only finite nonnegative reported costs", () => {
  expect(parseExaCost({ costDollars: { total: 0.007 } })).toBe(0.007);
  expect(parseExaCost({ costDollars: { total: 0 } })).toBe(0);
  for (const total of [-1, NaN, Infinity, "0.007", null]) expect(parseExaCost({ costDollars: { total } })).toBeNull();
  expect(parseExaCost({})).toBeNull();
});
it("returns highlights, candidate images and bounded subpages in the existing discovery shape", async () => {
  const fake = vi.fn().mockResolvedValue(
    new Response(
      JSON.stringify({
        costDollars: { total: 0.007 },
        results: [
          {
            url: "https://example.org/course",
            title: "Course",
            highlights: ["Eigenvectors stay on their axis"],
            summary: "An eigenvector summary",
            extras: { imageLinks: ["https://example.org/figure.png", "https://example.org/bad.svg"] },
            subpages: [{ url: "https://example.org/course/lesson", title: "Lesson", highlights: ["Worked example"] }],
          },
        ],
      }),
    ),
  );
  const result = await exaAdapter("fake", fake).search({ query: "eigenvectors", slot: "foundation" });
  expect(result.results).toHaveLength(2);
  expect(result.results[0]).toMatchObject({
    highlights: ["Eigenvectors stay on their axis"],
    summary: "An eigenvector summary",
    images: [{ url: "https://example.org/figure.png", alt: "", nearHeading: "" }],
  });
});

it("falls back after rank/fetch rejects enough discovery leads, and allows an explicit hard-gap retry", async () => {
  const exa = {
    name: "exa" as const,
    search: vi.fn(async (_req: import("./backends.js").SearchRequest) => ({
      results: [lead(1), lead(2), lead(3)],
      warnings: [],
      costUsd: 0.007,
    })),
  };
  const fallback = {
    name: "searxng" as const,
    search: vi.fn(async () => ({ results: [lead(4, "searxng")], warnings: [], costUsd: 0 })),
  };
  const service = new SearchService(await root(), [exa, fallback]);
  await service.search({ query: "chains", concept: "chains" });
  expect(fallback.search).not.toHaveBeenCalled();
  const response = await service.fallbackAfterScout([lead(1).url, lead(2).url, lead(3).url], [lead(1).url]);
  expect(response?.results).toEqual([lead(4, "searxng")]);
  expect(await service.fallbackAfterScout([lead(1).url], [])).toBeNull();
  await service.search({ query: "hard chains gap", concept: "chains", purpose: "hard-gap" });
  expect(exa.search.mock.calls[1]?.[0]?.exaOptions?.type).toBe("deep-lite");
}, 12000);
