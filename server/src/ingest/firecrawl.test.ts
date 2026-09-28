import { afterEach, describe, expect, it, vi } from "vitest";
import { FirecrawlError, firecrawlScrape } from "./firecrawl.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("firecrawlScrape", () => {
  it("posts to /v1/scrape with a bearer token and returns markdown", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            success: true,
            data: { markdown: "# Article", metadata: { title: "Article" }, url: "http://93.184.216.34/a" },
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
    expect(String(call?.[0])).toBe("http://93.184.216.34:3002/v1/scrape");
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
});
