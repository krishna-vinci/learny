import { afterEach, describe, expect, it, vi } from "vitest";
import { wikiTools } from "./wiki.js";

const fetchMock = vi.fn();

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
}

function byName(name: string) {
  const tool = wikiTools().find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`missing tool ${name}`);
  return tool;
}

describe("wikiTools", () => {
  afterEach(() => {
    fetchMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("searches the English Wikipedia REST API", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      json({
        pages: [
          {
            id: 1,
            key: "Vector_space",
            title: "Vector space",
            description: "Algebraic structure",
            excerpt: "A set whose <span>elements</span> can be added",
          },
        ],
      }),
    );

    const outcome = await byName("wiki_search").execute(
      "call-1",
      { query: "vector space", limit: 5 },
      undefined,
      undefined,
      undefined as never,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://en.wikipedia.org/w/rest.php/v1/search/page?q=vector+space&limit=5",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(outcome.details).toMatchObject({ isError: false, summary: "found 1 Wikipedia results" });
    const text = outcome.content[0]?.type === "text" ? outcome.content[0].text : "";
    expect(text).toContain("**Vector space** — Algebraic structure");
    expect(text).toContain("whose elements");
  });

  it("reads an article as capped markdown", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      new Response(
        `<!doctype html><html><head><title>Vector space</title></head><body><article><h2>Definition</h2><p>A vector space is closed under addition.</p></article></body></html>`,
        { status: 200, headers: { "content-type": "text/html" } },
      ),
    );

    const outcome = await byName("wiki_read").execute(
      "call-1",
      { title: "Vector space" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      "https://en.wikipedia.org/api/rest_v1/page/html/Vector%20space",
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(outcome.details).toMatchObject({ isError: false, summary: "read Wikipedia page Vector space" });
    const text = outcome.content[0]?.type === "text" ? outcome.content[0].text : "";
    expect(text).toContain("# Vector space");
    expect(text).toContain("closed under addition");
  });

  it("returns a tool error for a failed API response", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(json({ error: "missing" }, 404));

    const outcome = await byName("wiki_search").execute(
      "call-1",
      { query: "missing" },
      undefined,
      undefined,
      undefined as never,
    );

    expect(outcome.details).toMatchObject({ isError: true, summary: "Wikipedia request failed with HTTP 404" });
  });
});
