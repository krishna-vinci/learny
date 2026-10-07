import JSZip from "jszip";
import { afterEach, describe, expect, it, vi } from "vitest";
import { mineruEndpoint, mineruHealth, mineruParse, mineruTimeoutMs } from "./mineru.js";

const bytes = new TextEncoder().encode("%PDF-1.4");
const options = { mineruUrl: "http://127.0.0.1:18750", apiKey: "test-key", tier: "basic" };
const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const done = (status = "completed") => ({
  job_id: "job_1",
  status,
  files: [{ output_files: { markdown: { file_id: "md_1" } } }],
});
function fake(status = "completed", uploadUrl = "/v1/uploads/upload_1/content") {
  const mock = vi.fn<typeof fetch>(async (url) => {
    const pathname = new URL(String(url)).pathname;
    if (pathname === "/v1/health") return response({ status: "ok", version: "4.0.10" });
    if (pathname === "/v1/uploads") return response({ id: "upload_1", upload_url: uploadUrl });
    if (pathname.endsWith("/complete")) return response({ status: "completed", file: { id: "file_1" } });
    if (pathname === "/v1/parse/jobs") return response(done(status));
    if (pathname === "/v1/parse/jobs/job_1") return response(done());
    if (pathname === "/v1/files/md_1/content") return new Response("# Parsed\n\nBody $x$.");
    return response({});
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("MinerU V1", () => {
  it("uploads bytes, completes upload, submits with tier and bearer, polls with backoff, downloads markdown", async () => {
    vi.useFakeTimers();
    const fetch = fake("queued");
    const progress = vi.fn();
    const promise = mineruParse(bytes, { ...options, onProgress: progress });
    await vi.advanceTimersByTimeAsync(1000);
    expect(await promise).toContain("Body $x$.");
    expect(fetch.mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
      "/v1/health",
      "/v1/uploads",
      "/v1/uploads/upload_1/content",
      "/v1/uploads/upload_1/complete",
      "/v1/parse/jobs",
      "/v1/parse/jobs/job_1",
      "/v1/files/md_1/content",
    ]);
    expect(JSON.parse(String(fetch.mock.calls[1]?.[1]?.body))).toMatchObject({ bytes: bytes.length, purpose: "parse" });
    expect(JSON.parse(String(fetch.mock.calls[4]?.[1]?.body))).toMatchObject({
      files: [{ source: { type: "file_id", file_id: "file_1" } }],
      tier: "basic",
      output_formats: ["markdown", "zip"],
    });
    expect(
      fetch.mock.calls.every(
        ([, init]) =>
          (init?.headers as Record<string, string> | undefined)?.Authorization === "Bearer test-key" &&
          init?.redirect === "error",
      ),
    ).toBe(true);
    expect(progress).toHaveBeenCalledWith("Parsing PDF with MinerU: waiting (queued)");
  });
  it("handles cached uploads and reports a usable partial result", async () => {
    const fetch = fake("partial");
    fetch.mockImplementationOnce(async () => response({ status: "ok" }));
    fetch.mockImplementationOnce(async () => response({ status: "completed", file: { id: "file_1" } }));
    const onWarning = vi.fn();
    expect(await mineruParse(bytes, { ...options, onWarning })).toContain("Parsed");
    expect(onWarning).toHaveBeenCalledWith(expect.stringContaining("partial"));
    expect(fetch.mock.calls.some(([, init]) => init?.method === "PUT")).toBe(false);
  });
  it.each(["failed", "canceled"])("stops immediately at %s", async (status) => {
    const fetch = fake(status);
    await expect(mineruParse(bytes, options)).rejects.toThrow(`job ${status}`);
    expect(fetch.mock.calls.some(([url]) => String(url).includes("/v1/files/"))).toBe(false);
  });
  it("times out a waiting job and cancels it", async () => {
    vi.useFakeTimers();
    const fetch = fake("running");
    const promise = expect(mineruParse(bytes, { ...options, timeoutMs: 100 })).rejects.toThrow("timed out");
    await vi.advanceTimersByTimeAsync(100);
    await promise;
    expect(fetch.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
    expect(mineruTimeoutMs(1)).toBe(600_000);
    expect(mineruTimeoutMs(30)).toBe(900_000);
    expect(mineruTimeoutMs(2000)).toBe(10_800_000);
  });
  it("propagates caller abort and cancels the remote job", async () => {
    const controller = new AbortController();
    const fetch = fake("running");
    const promise = mineruParse(bytes, {
      ...options,
      signal: controller.signal,
      onProgress: (message) => {
        if (message.endsWith("(running)")) controller.abort(new Error("learner canceled"));
      },
    });
    await expect(promise).rejects.toThrow("learner canceled");
    expect(fetch.mock.calls.at(-1)?.[1]?.method).toBe("DELETE");
  });
  it("uses legacy only when V1 health is absent", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(response({}, 404))
      .mockResolvedValueOnce(response({ results: { pdf: { md_content: "# Legacy" } } }));
    vi.stubGlobal("fetch", fetch);
    expect(await mineruParse(bytes, options)).toBe("# Legacy");
    expect(String(fetch.mock.calls[1]?.[0])).toMatch(/\/file_parse$/);
    expect(fetch.mock.calls[1]?.[1]?.body).toBeInstanceOf(FormData);
    fetch.mockReset().mockResolvedValue(response({}, 503));
    await expect(mineruParse(bytes, options)).rejects.toThrow("health HTTP 503");
    expect(fetch).toHaveBeenCalledOnce();
  });
  it.each([
    "http://127.0.0.1:18751/upload",
    "http://localhost:18750/upload",
    "https://127.0.0.1:18750/upload",
    "http://192.168.1.3/upload",
    "https://example.org/upload",
  ])("rejects server-supplied off-origin URL %s before credentials or bytes are sent", async (url) => {
    const fetch = fake("completed", url);
    await expect(mineruParse(bytes, options)).rejects.toThrow("configured HTTP(S) origin");
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it("allows only exact configured origin, rejects credential URLs, does not follow redirects", async () => {
    expect(mineruEndpoint(options.mineruUrl, "/v1/health").origin).toBe(options.mineruUrl);
    expect(() => mineruEndpoint(options.mineruUrl, "http://user:pass@127.0.0.1:18750/a")).toThrow("credentials");
    const fetch = fake();
    fetch.mockResolvedValueOnce(response({}, 302));
    await expect(mineruParse(bytes, options)).rejects.toThrow("health HTTP 302");
    expect(fetch.mock.calls[0]?.[1]?.redirect).toBe("error");
  });
  it("reports health version and configured tier without probing a parse", async () => {
    const fetch = fake();
    expect(await mineruHealth({ ...options, tier: "standard" })).toMatchObject({
      reachable: true,
      version: "4.0.10",
      tier: "standard",
    });
    expect(fetch).toHaveBeenCalledOnce();
  });
  it("materializes archive figures without writing server paths to disk", async () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.write("IHDR", 12);
    png.writeUInt32BE(200, 16);
    png.writeUInt32BE(200, 20);
    const zip = new JSZip();
    zip.file("images/figure.png", png);
    const archive = await zip.generateAsync({ type: "uint8array" });
    const fetch = fake();
    fetch.mockImplementation(async (url) => {
      const p = new URL(String(url)).pathname;
      if (p === "/v1/health") return response({ status: "ok" });
      if (p === "/v1/uploads") return response({ status: "completed", file: { id: "file_1" } });
      if (p === "/v1/parse/jobs")
        return response({
          ...done(),
          files: [{ output_files: { markdown: { file_id: "md_1" }, zip: { file_id: "zip_1" } } }],
        });
      if (p === "/v1/files/md_1/content") return new Response("![Figure](images/figure.png)");
      return new Response(archive);
    });
    expect(await mineruParse(bytes, options)).toContain(`data:image/png;base64,${png.toString("base64")}`);
  });
});
