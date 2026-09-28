import { afterEach, describe, expect, it, vi } from "vitest";
import { makePdf } from "./fixtures.test-helper.js";
import { extract, UnsupportedInputError } from "./types.js";

vi.mock("node:dns", () => ({
  promises: { lookup: vi.fn(async () => [{ address: "93.184.216.34", family: 4 }]) },
}));

const DENSE = "The quick brown fox jumps over the lazy dog and keeps on running for a while. ".repeat(4);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("extract", () => {
  it("passes through markdown and text with a derived title", async () => {
    const text = new TextEncoder().encode("# My Note\n\nSome content.\n");
    const extracted = await extract("markdown", { bytes: text, filename: "note.md" });
    expect(extracted.title).toBe("My Note");
    expect(extracted.markdown).toContain("Some content.");
    expect(extracted.originalExt).toBe("md");
  });

  it("converts inline HTML to markdown", async () => {
    const html = `<html><head><title>T</title></head><body><article><h1>T</h1><p>${"word ".repeat(120)}</p></article></body></html>`;
    const extracted = await extract("html", { bytes: new TextEncoder().encode(html) });
    expect(extracted.markdown).toContain("word");
    expect(extracted.parseTier).toBe("basic");
  });

  it("downloads arXiv URLs as PDFs but keeps the abstract URL", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response(makePdf([DENSE]), { headers: { "content-type": "application/pdf" } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const extracted = await extract("arxiv", { url: "https://arxiv.org/abs/1706.03762" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://arxiv.org/pdf/1706.03762");
    expect(extracted.url).toBe("https://arxiv.org/abs/1706.03762");
    expect(extracted.markdown).toContain("<!-- p:1 -->");
    expect(extracted.originalExt).toBe("pdf");
  });

  it("routes PDF-content DOIs through the PDF extractor", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(makePdf([DENSE]), { headers: { "content-type": "application/pdf" } })),
    );
    const extracted = await extract("doi", { url: "https://doi.org/10.1000/182" });
    expect(extracted.originalExt).toBe("pdf");
    expect(extracted.pages).toBe(1);
  });

  it("rejects images, audio and PPTX", async () => {
    await expect(extract("image", { bytes: new Uint8Array([1]) })).rejects.toBeInstanceOf(UnsupportedInputError);
    await expect(extract("audio", { bytes: new Uint8Array([1]) })).rejects.toBeInstanceOf(UnsupportedInputError);
    await expect(extract("pptx", { bytes: new Uint8Array([1]) })).rejects.toBeInstanceOf(UnsupportedInputError);
  });
});
