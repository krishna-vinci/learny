import { afterEach, describe, expect, it, vi } from "vitest";
import { mineruParse } from "./mineru.js";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("mineruParse", () => {
  it("posts the file and returns markdown from the results map", async () => {
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response(JSON.stringify({ results: { "paper.pdf": { md_content: "# Parsed\n\nBody text." } } }), {
          headers: { "content-type": "application/json" },
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const markdown = await mineruParse(new TextEncoder().encode("%PDF-1.4"), {
      mineruUrl: "http://93.184.216.34:8081",
    });
    expect(markdown).toContain("Body text.");
    const call = fetchMock.mock.calls[0];
    expect(String(call?.[0])).toBe("http://93.184.216.34:8081/file_parse");
    expect(call?.[1]?.method).toBe("POST");
  });

  it("throws when the response has no markdown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify({ results: {} }), { headers: { "content-type": "application/json" } }),
      ),
    );
    await expect(
      mineruParse(new TextEncoder().encode("%PDF-1.4"), { mineruUrl: "http://93.184.216.34:8081" }),
    ).rejects.toThrow("no markdown");
  });
});
