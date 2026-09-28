import { afterEach, describe, expect, it, vi } from "vitest";
import { makePdf } from "./fixtures.test-helper.js";
import { extractPdf, PDF_MAX_PAGES } from "./pdf.js";

const PAGE_ONE = "The quick brown fox jumps over the lazy dog and keeps on running for a while. ".repeat(4);
const PAGE_TWO = "Linear algebra studies vectors, matrices and the linear maps between them. ".repeat(4);

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("extractPdf", () => {
  it("keeps page anchors and reports the page count", async () => {
    const bytes = makePdf([PAGE_ONE, PAGE_TWO]);
    const extracted = await extractPdf(bytes);
    expect(extracted.markdown).toContain("<!-- p:1 -->");
    expect(extracted.markdown).toContain("<!-- p:2 -->");
    expect(extracted.markdown).toContain("quick brown fox");
    expect(extracted.markdown).toContain("Linear algebra studies vectors");
    expect(extracted.pages).toBe(2);
    expect(extracted.parseTier).toBe("basic");
    expect(extracted.originalExt).toBe("pdf");
    expect(extracted.warning).toBeNull();
  });

  it("reads the title and author from PDF metadata", async () => {
    const bytes = makePdf([PAGE_ONE], { title: "A Study of Things", author: "Ada Lovelace; Alan Turing" });
    const extracted = await extractPdf(bytes);
    expect(extracted.title).toBe("A Study of Things");
    expect(extracted.authors).toEqual(["Ada Lovelace", "Alan Turing"]);
  });

  it("warns when the text layer is poor and MinerU is not configured", async () => {
    const extracted = await extractPdf(makePdf(["tiny"]));
    expect(extracted.parseTier).toBe("basic");
    expect(extracted.warning).toContain("poor PDF text layer");
    expect(extracted.warning).toContain("MINERU_URL");
  });

  it("rejects a PDF that declares too many pages before extracting text", async () => {
    const bytes = makePdf(Array.from({ length: PDF_MAX_PAGES + 1 }, () => "one"));
    await expect(extractPdf(bytes)).rejects.toThrow(/too many pages/);
  });

  it("falls back to MinerU when the text layer is poor", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response(
          JSON.stringify({ results: { "document.pdf": { md_content: "# MinerU output\n\nRecovered text." } } }),
          {
            headers: { "content-type": "application/json" },
          },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const extracted = await extractPdf(makePdf(["tiny"]), { mineruUrl: "http://93.184.216.34:8081" });
    expect(extracted.parseTier).toBe("mineru");
    expect(extracted.markdown).toContain("MinerU output");
    expect(extracted.warning).toBeNull();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/file_parse");
  });

  it("keeps the basic text and warns when MinerU fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 500 })),
    );
    const extracted = await extractPdf(makePdf(["tiny"]), { mineruUrl: "http://93.184.216.34:8081" });
    expect(extracted.parseTier).toBe("basic");
    expect(extracted.warning).toContain("MinerU failed");
  });
});
