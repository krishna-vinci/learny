import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { exaAdapter, routeBackends, SearchService, searxngAdapter } from "./backends.js";

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
  it("verifies science engine answers rather than trusting requested names", async () => {
    const fake = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          results: [
            { url: "https://arxiv.org/abs/1", engines: ["arxiv"] },
            { url: "https://other.test/", engines: ["bing"] },
          ],
        }),
      ),
    );
    const r = await searxngAdapter("http://localhost:8080", fake).search({ query: "polymer", slot: "paper" });
    expect(r.results).toHaveLength(1);
    expect(r.warnings).toHaveLength(1);
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
    expect((await service.search({ query: "A" })).results).toHaveLength(1);
    expect((await new SearchService(r, [exa, searx], usage).search({ query: "A" })).cached).toBe(true);
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
    expect(routeBackends("video")).toEqual(["searxng"]);
    expect(routeBackends("paper")).toEqual(["searxng", "exa"]);
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
