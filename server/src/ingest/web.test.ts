import { afterEach, describe, expect, it, vi } from "vitest";
import { extractWeb, htmlToMarkdown } from "./web.js";

const ARTICLE = `<html><head><title>Understanding Things</title></head><body>
  <nav>site menu</nav>
  <article><h1>Understanding Things</h1>
  <p>${"This paragraph explains the topic in enough detail to be readerable. ".repeat(12)}</p>
  <p>${"A second paragraph continues the explanation with more detail. ".repeat(12)}</p>
  <script>window.evil = true</script></article>
</body></html>`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("htmlToMarkdown", () => {
  it("extracts the article body and drops scripts", () => {
    const converted = htmlToMarkdown(ARTICLE, "http://93.184.216.34/post");
    expect(converted.title).toBe("Understanding Things");
    expect(converted.markdown).toContain("# Understanding Things");
    expect(converted.markdown).toContain("explains the topic");
    expect(converted.markdown).not.toContain("window.evil");
  });
});

describe("extractWeb", () => {
  it("fetches and converts a page with readability", async () => {
    const fetchMock = vi.fn(async () => new Response(ARTICLE, { headers: { "content-type": "text/html" } }));
    vi.stubGlobal("fetch", fetchMock);

    const extracted = await extractWeb("http://93.184.216.34/post");
    expect(extracted.parseTier).toBe("basic");
    expect(extracted.title).toBe("Understanding Things");
    expect(extracted.markdown).toContain("explains the topic");
    expect(extracted.url).toBe("http://93.184.216.34/post");
  });

  it("prefers Firecrawl when configured", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            success: true,
            data: {
              markdown: "# From Firecrawl\n\nClean text.",
              metadata: { title: "FC" },
              url: "http://93.184.216.34/post",
            },
          }),
          { headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const extracted = await extractWeb("http://93.184.216.34/post", { firecrawlUrl: "http://93.184.216.34:3002" });
    expect(extracted.parseTier).toBe("firecrawl");
    expect(extracted.title).toBe("FC");
    expect(extracted.markdown).toContain("From Firecrawl");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v1/scrape");
  });

  it("falls back to readability when Firecrawl fails", async () => {
    const fetchMock = vi.fn(async (input: URL | string) => {
      if (String(input).includes(":3002")) {
        return new Response(JSON.stringify({ success: false, error: "boom" }), {
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(ARTICLE, { headers: { "content-type": "text/html" } });
    });
    vi.stubGlobal("fetch", fetchMock);

    const extracted = await extractWeb("http://93.184.216.34/post", { firecrawlUrl: "http://93.184.216.34:3002" });
    expect(extracted.parseTier).toBe("basic");
    expect(extracted.warning).toContain("Firecrawl failed");
    expect(extracted.markdown).toContain("explains the topic");
  });
});
