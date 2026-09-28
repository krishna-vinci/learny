import { afterEach, describe, expect, it, vi } from "vitest";
import { webFetchTool } from "./web-fetch.js";

const fetchMock = vi.fn();
const lookupMock = vi.hoisted(() => vi.fn());

vi.mock("node:dns", () => ({ promises: { lookup: lookupMock } }));

function tool(opts: Parameters<typeof webFetchTool>[0] = {}) {
  return webFetchTool(opts);
}

async function execute(url: string, opts: Parameters<typeof webFetchTool>[0] = {}) {
  const definition = tool(opts);
  return definition.execute("call-1", { url }, undefined, undefined, undefined as never);
}

describe("webFetchTool", () => {
  afterEach(() => {
    fetchMock.mockReset();
    lookupMock.mockReset();
    vi.unstubAllGlobals();
  });

  it("converts a readable public page to markdown", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      new Response(
        `<!doctype html><html><head><title>Studium</title></head><body><article><h1>Studium</h1><p>Files are the system of record.</p></article></body></html>`,
        { status: 200 },
      ),
    );

    const outcome = await execute("https://93.184.216.34/docs");

    expect(fetchMock).toHaveBeenCalledWith(
      new URL("https://93.184.216.34/docs"),
      expect.objectContaining({ redirect: "manual", signal: expect.any(AbortSignal) }),
    );
    expect(outcome.details).toMatchObject({ isError: false, summary: "fetched 93.184.216.34" });
    const text = outcome.content[0]?.type === "text" ? outcome.content[0].text : "";
    expect(text).toContain("# Studium");
    expect(text).toContain("Files are the system of record");
  });

  it.each([
    "http://127.0.0.1/",
    "http://localhost/",
    "http://printer.local/",
    "file:///etc/passwd",
    "https://user:secret@93.184.216.34/",
  ] as const)("blocks unsafe URL %s", async (url) => {
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await execute(url);

    expect(outcome.details).toMatchObject({ isError: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks a hostname that resolves to a private address", async () => {
    lookupMock.mockResolvedValue([{ address: "192.168.1.4", family: 4 }]);
    vi.stubGlobal("fetch", fetchMock);

    const outcome = await execute("https://rebind.example/");

    expect(lookupMock).toHaveBeenCalledWith("rebind.example", { all: true, verbatim: true });
    expect(outcome.details).toMatchObject({
      isError: true,
      summary: "Refusing to fetch rebind.example (resolves to 192.168.1.4)",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("validates every redirect target", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValueOnce(
      new Response(null, { status: 302, headers: { location: "http://127.0.0.1/secret" } }),
    );

    const outcome = await execute("https://93.184.216.34/redirect");

    expect(outcome.details).toMatchObject({ isError: true, summary: "Refusing to fetch private address: 127.0.0.1" });
  });

  it("rejects a response whose declared body exceeds the download cap", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      new Response("too large", { status: 200, headers: { "content-length": String(5 * 1024 * 1024 + 1) } }),
    );

    const outcome = await execute("https://93.184.216.34/large");

    expect(outcome.details).toMatchObject({ isError: true, summary: expect.stringContaining("exceeds") });
  });

  it("uses configured Firecrawl and returns its markdown", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockResolvedValue(
      json({
        success: true,
        data: { markdown: "# Fetched by Firecrawl\n\nAdvanced extraction." },
      }),
    );

    const outcome = await execute("https://93.184.216.34/doc", {
      firecrawlUrl: "https://firecrawl.example/v1",
      firecrawlKey: "test-key",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://firecrawl.example/v1/scrape",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({ authorization: "Bearer test-key" }),
      }),
    );
    expect(outcome.details).toMatchObject({ isError: false, summary: "fetched 93.184.216.34 with Firecrawl" });
    expect(outcome.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Advanced extraction") });
  });

  it("caps a Firecrawl response before falling back to the built-in fetch", async () => {
    vi.stubGlobal("fetch", fetchMock);
    fetchMock
      .mockResolvedValueOnce(new Response("oversized", { headers: { "content-length": String(5 * 1024 * 1024 + 1) } }))
      .mockResolvedValueOnce(
        new Response("<!doctype html><html><body><article><p>Built-in fallback.</p></article></body></html>"),
      );

    const outcome = await execute("https://93.184.216.34/doc", {
      firecrawlUrl: "https://firecrawl.example/v1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(outcome.details).toMatchObject({ isError: false, summary: "fetched 93.184.216.34" });
    expect(outcome.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Built-in fallback") });
  });
});

function json(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}
