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
              markdown: "# From Firecrawl\n\nClean text.\n\n![Diagram](https://93.184.216.34/figure.png)",
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
    expect(extracted.images).toEqual([
      { url: "https://93.184.216.34/figure.png", alt: "Diagram", nearHeading: "From Firecrawl" },
    ]);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/v2/scrape");
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

it("preserves exact TeX, GFM tables, code languages and figure captions", () => {
  const result = htmlToMarkdown(
    `<html><body><article><h1>Math</h1><p>Inline <span class="katex"><math><semantics><mi>garbled</mi><annotation encoding="application/x-tex">x^2 + \\alpha</annotation></semantics></math></span>.</p><script type="math/tex; mode=display">E=mc^2</script><table><tr><th>A</th><th>B</th></tr><tr><td>1</td><td>2</td></tr></table><pre><code class="language-python">print(1)</code></pre><figure><img src="https://example.com/a.png" alt="Experiment"><figcaption>A measured result.</figcaption></figure></article></body></html>`,
    "https://example.com/a",
  );
  expect(result.markdown).toContain("$x^2 + \\alpha$");
  expect(result.markdown).toContain("$$\nE=mc^2\n$$");
  expect(result.markdown).toContain("| A | B |\n| --- | --- |\n| 1 | 2 |");
  expect(result.markdown).toContain("```python\nprint(1)");
  expect(result.markdown).toContain("A measured result.");
  expect(result.images[0]?.alt).toBe("Experiment");
  expect(result.markdown).not.toContain("garbled");
});
it("retains explicit restrictive LibreTexts page licenses rather than assuming host-wide reuse", () => {
  const html = `<html><head><title>Polymer chains</title><script>["license:ccbync", "licenseversion:30"]</script></head><body><article><h1>Polymer chains</h1><p>${"Polymer chains explain material properties. ".repeat(30)}</p><figure><img src="/chains.png" alt="Polymer chains"><figcaption>Chain structure</figcaption></figure></article></body></html>`;
  expect(htmlToMarkdown(html, "https://chem.libretexts.org/Bookshelves/Polymers").images[0]).toMatchObject({
    caption: "Chain structure",
    license: "CC BY-NC 3.0",
  });
  expect(htmlToMarkdown(html, "https://example.org/Polymers").images[0]?.license).toBeUndefined();
});
it("keeps individual figure licenses separate and preserves restrictive caption exceptions", () => {
  const html = `<html><body><article><h1>Polymer chains</h1><p>${"Polymer chains explain material properties. ".repeat(30)}</p>
    <figure><img src="/chains.png" alt="Polymer chains"><figcaption>Named author, <a href="https://creativecommons.org/licenses/by/4.0/">CC BY 4.0</a></figcaption></figure>
    <figure><img src="/other.png" alt="Other chains"><figcaption>Other example</figcaption></figure>
    <figure><img src="/reserved.png" alt="Measured chains"><figcaption>All rights reserved</figcaption></figure>
    </article></body></html>`;
  const images = htmlToMarkdown(html, "https://example.org/chains").images;
  expect(images.find((i) => i.url.endsWith("/chains.png"))?.license).toBe("CC BY 4.0");
  expect(images.find((i) => i.url.endsWith("/chains.png"))?.credit).toContain("Named author");
  expect(images.find((i) => i.url.endsWith("/other.png"))?.license).toBeUndefined();
  expect(images.find((i) => i.url.endsWith("/reserved.png"))?.license).toBe("all rights reserved");
});
