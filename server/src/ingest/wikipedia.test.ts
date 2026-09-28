import { afterEach, describe, expect, it, vi } from "vitest";
import { extractWikipedia } from "./wikipedia.js";

vi.mock("node:dns", () => ({
  promises: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) },
}));

const ARTICLE = `<html><head><title>Linear algebra</title></head><body>
  <article><h1>Linear algebra</h1>
  <p>${"Linear algebra is the branch of mathematics concerning linear equations and maps. ".repeat(12)}</p>
  </article></body></html>`;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("extractWikipedia", () => {
  it("fetches the English REST article and converts it to markdown", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response(ARTICLE, { headers: { "content-type": "text/html; charset=utf-8" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const extracted = await extractWikipedia("https://en.wikipedia.org/wiki/Linear_algebra");
    expect(extracted.parseTier).toBe("basic");
    expect(extracted.title).toBe("Linear algebra");
    expect(extracted.markdown).toContain("branch of mathematics");
    expect(extracted.url).toBe("https://en.wikipedia.org/wiki/Linear_algebra");

    const requested = String(fetchMock.mock.calls[0]?.[0]);
    expect(requested).toBe("https://en.wikipedia.org/api/rest_v1/page/html/Linear_algebra");
  });

  it("rejects URLs without an article title", async () => {
    await expect(extractWikipedia("https://en.wikipedia.org/wiki/")).rejects.toMatchObject({ kind: "wikipedia" });
  });
});
