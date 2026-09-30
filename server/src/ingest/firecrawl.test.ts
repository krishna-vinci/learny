import { afterEach, describe, expect, it, vi } from "vitest";
import { FirecrawlError, firecrawlScrape, firecrawlScrapeEndpoint } from "./firecrawl.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
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
