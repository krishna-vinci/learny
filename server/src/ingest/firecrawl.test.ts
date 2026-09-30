import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FirecrawlError, firecrawlMap, firecrawlScrape, firecrawlScrapeEndpoint } from "./firecrawl.js";
import { SAFE_FETCH_MAX_BYTES } from "./safe-fetch.js";

const lookupMock = vi.hoisted(() => vi.fn());
vi.mock("node:dns", () => ({ promises: { lookup: lookupMock } }));

beforeEach(() => {
  lookupMock.mockReset();
  lookupMock.mockImplementation(async (host: string) => [
    { address: host === "private.example.com" ? "192.168.1.1" : "93.184.216.34", family: 4 },
  ]);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("firecrawlMap", () => {
  it("posts the v2 map options and accepts strings and objects with optional metadata", async () => {
    const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) =>
      Response.json({
        success: true,
        links: [
          "https://example.com/start",
          { url: "https://docs.example.com/guide", title: "Guide", description: "Getting started" },
          { url: "https://www.example.com/api", title: 5, description: null },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const options = { baseUrl: "http://127.0.0.1:3002/v1/scrape/", apiKey: "secret", search: "guide", limit: 20 };
    const pages = await firecrawlMap("https://WWW.EXAMPLE.COM/", options);
    expect(pages).toEqual([
      { url: "https://example.com/start" },
      { url: "https://docs.example.com/guide", title: "Guide", description: "Getting started" },
      { url: "https://www.example.com/api" },
    ]);
    const [endpoint, init] = fetchMock.mock.calls[0] ?? [];
    expect(endpoint).toBe("http://127.0.0.1:3002/v2/map");
    expect(init).toMatchObject({ method: "POST", redirect: "error", headers: { authorization: "Bearer secret" } });
    expect(JSON.parse(String(init?.body))).toEqual({
      url: "https://WWW.EXAMPLE.COM/",
      search: "guide",
      limit: 20,
      includeSubdomains: false,
      ignoreQueryParameters: true,
    });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it("drops off-site, malformed and private links, including same-site DNS resolving privately", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          success: true,
          links: [
            "https://example.com/ok",
            "https://child.example.com/ok",
            "https://private.example.com/admin",
            "https://example.com.evil.org/",
            "https://notexample.com/",
            "https://example.org/",
            "http://127.0.0.1/",
            "http://192.168.1.1/",
            "https://user:pass@example.com/",
            "ftp://example.com/",
            "not a URL",
            null,
            { title: "No URL" },
          ],
        }),
      ),
    );
    await expect(firecrawlMap("https://example.com", { baseUrl: "http://localhost:3002" })).resolves.toEqual([
      { url: "https://example.com/ok" },
      { url: "https://child.example.com/ok" },
    ]);
    expect(lookupMock).toHaveBeenCalledWith("private.example.com", { all: true, verbatim: true });
    expect(lookupMock.mock.calls.some(([host]) => host === "example.com.evil.org")).toBe(false);
  });

  it("does not expand a subdomain input to its parent or sibling", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({
          links: [
            "https://docs.example.com/",
            "https://www.docs.example.com/",
            "https://api.docs.example.com/",
            "https://example.com/",
            "https://other.example.com/",
          ],
        }),
      ),
    );
    await expect(
      firecrawlMap("https://docs.example.com", { baseUrl: "http://localhost:3002/v2/map" }),
    ).resolves.toEqual([
      { url: "https://docs.example.com/" },
      { url: "https://www.docs.example.com/" },
      { url: "https://api.docs.example.com/" },
    ]);
  });

  it("refuses private site URLs and invalid limits before contacting Firecrawl", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(firecrawlMap("http://127.0.0.1", { baseUrl: "http://localhost:3002" })).rejects.toThrow();
    await expect(firecrawlMap("https://example.com", { baseUrl: "http://localhost:3002", limit: 501 })).rejects.toThrow(
      "limit",
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    [JSON.stringify({ success: false, error: "map unavailable" }), 200],
    [JSON.stringify({ error: "unavailable" }), 503],
    ["bad JSON", 200],
    ["null", 200],
    [JSON.stringify({ success: true, links: {} }), 200],
  ])("reports failed or malformed map responses (%s, %s)", async (body, status) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(body, { status })),
    );
    await expect(firecrawlMap("https://example.com", { baseUrl: "http://localhost:3002" })).rejects.toBeInstanceOf(
      FirecrawlError,
    );
  });

  it("caps responses, limits pages, and propagates cancellation and timeouts to fetch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { headers: { "content-length": String(SAFE_FETCH_MAX_BYTES + 1) } })),
    );
    await expect(firecrawlMap("https://example.com", { baseUrl: "http://localhost:3002" })).rejects.toThrow("exceeds");

    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ links: ["https://example.com/1", "https://example.com/2"] })),
    );
    await expect(
      firecrawlMap("https://example.com", { baseUrl: "http://localhost:3002", limit: 1 }),
    ).resolves.toHaveLength(1);

    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: unknown, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            const signal = init?.signal;
            if (signal?.aborted) reject(signal.reason);
            else signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
          }),
      ),
    );
    const controller = new AbortController();
    controller.abort();
    await expect(
      firecrawlMap("https://example.com", { baseUrl: "http://localhost:3002", signal: controller.signal }),
    ).rejects.toBeInstanceOf(FirecrawlError);
    await expect(
      firecrawlMap("https://example.com", { baseUrl: "http://localhost:3002", timeoutMs: 5 }),
    ).rejects.toBeInstanceOf(FirecrawlError);
  });
});

describe("firecrawlScrape", () => {
  it("posts to /v2/scrape with a bearer token and returns markdown", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            success: true,
            data: { markdown: "# Article", metadata: { title: "Article", sourceURL: "http://93.184.216.34/a" } },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await firecrawlScrape("http://93.184.216.34/a", {
      baseUrl: "http://93.184.216.34:3002/",
      apiKey: "secret",
    });
    expect(result.markdown).toContain("Article");
    expect(result.title).toBe("Article");

    const call = fetchMock.mock.calls[0];
    expect(String(call?.[0])).toBe("http://93.184.216.34:3002/v2/scrape");
    expect(call?.[1]?.method).toBe("POST");
    expect(call?.[1]?.headers).toMatchObject({ authorization: "Bearer secret" });
  });

  it("throws when Firecrawl reports failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: false, error: "bad url" }), {
            headers: { "content-type": "application/json" },
          }),
      ),
    );
    await expect(
      firecrawlScrape("http://93.184.216.34/a", { baseUrl: "http://93.184.216.34:3002" }),
    ).rejects.toBeInstanceOf(FirecrawlError);
  });

  it("accepts a LAN or localhost Firecrawl but refuses private pages", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response(JSON.stringify({ success: true, data: { markdown: "# Ok", metadata: { title: "Ok" } } }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      firecrawlScrape("http://93.184.216.34/a", { baseUrl: "http://127.0.0.1:3002/v1" }),
    ).resolves.toMatchObject({ markdown: "# Ok" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("http://127.0.0.1:3002/v2/scrape");
    await expect(firecrawlScrape("http://192.168.0.10/admin", { baseUrl: "http://127.0.0.1:3002" })).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("normalizes configured base URLs to the v2 scrape endpoint", () => {
    for (const base of [
      "http://h:3002",
      "http://h:3002/",
      "http://h:3002/v1",
      "http://h:3002/v2/",
      "http://h:3002/v1/scrape",
    ]) {
      expect(firecrawlScrapeEndpoint(base)).toBe("http://h:3002/v2/scrape");
    }
  });
});
