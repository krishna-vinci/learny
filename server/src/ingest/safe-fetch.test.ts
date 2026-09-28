import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertPublicUrl,
  decodeBody,
  isBlockedAddress,
  isBlockedHostname,
  SafeFetchError,
  safeFetch,
} from "./safe-fetch.js";

vi.mock("node:dns", () => ({
  promises: {
    lookup: vi.fn(async (host: string) => {
      if (host === "blocked.example") return [{ address: "127.0.0.1", family: 4 }];
      if (host === "public.example") return [{ address: "93.184.216.34", family: 4 }];
      throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: "ENOTFOUND" });
    }),
  },
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isBlockedHostname", () => {
  it("blocks localhost and .local names", () => {
    for (const host of ["localhost", "LOCALHOST", "foo.local", "printer.local", "local", ""]) {
      expect(isBlockedHostname(host)).toBe(true);
    }
  });

  it("allows public hostnames", () => {
    for (const host of ["example.com", "en.wikipedia.org", "notlocal.example"]) {
      expect(isBlockedHostname(host)).toBe(false);
    }
  });
});

describe("isBlockedAddress", () => {
  it("blocks loopback, private, link-local and reserved ranges", () => {
    for (const address of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.1.1", "169.254.169.254", "0.0.0.0"]) {
      expect(isBlockedAddress(address)).toBe(true);
    }
    for (const address of ["::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1"]) {
      expect(isBlockedAddress(address)).toBe(true);
    }
  });

  it("allows public addresses", () => {
    for (const address of ["8.8.8.8", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isBlockedAddress(address)).toBe(false);
    }
  });
});

describe("assertPublicUrl", () => {
  it("rejects non-http protocols", async () => {
    await expect(assertPublicUrl("ftp://example.com/x")).rejects.toMatchObject({ code: "unsupported_protocol" });
  });

  it("rejects local hostnames without a DNS lookup", async () => {
    await expect(assertPublicUrl("http://localhost/")).rejects.toMatchObject({ code: "blocked_host" });
    await expect(assertPublicUrl("http://printer.local/")).rejects.toMatchObject({ code: "blocked_host" });
  });

  it("rejects private address literals", async () => {
    await expect(assertPublicUrl("http://127.0.0.1/")).rejects.toMatchObject({ code: "blocked_address" });
    await expect(assertPublicUrl("http://[::1]/")).rejects.toMatchObject({ code: "blocked_address" });
  });

  it("rejects hostnames that resolve to a private address", async () => {
    await expect(assertPublicUrl("https://blocked.example/")).rejects.toMatchObject({ code: "blocked_address" });
  });

  it("accepts public addresses and hostnames", async () => {
    await expect(assertPublicUrl("https://public.example/page")).resolves.toBeInstanceOf(URL);
    await expect(assertPublicUrl("https://93.184.216.34/page")).resolves.toBeInstanceOf(URL);
  });
});

describe("safeFetch", () => {
  it("does not call fetch for blocked URLs", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(safeFetch("http://127.0.0.1/secret")).rejects.toBeInstanceOf(SafeFetchError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns bytes and content type for a public response", async () => {
    const fetchMock = vi.fn(async () => new Response("hello", { headers: { "content-type": "text/plain" } }));
    vi.stubGlobal("fetch", fetchMock);
    const response = await safeFetch("https://93.184.216.34/page");
    expect(decodeBody(response.bytes, response.contentType)).toBe("hello");
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("re-validates redirect targets and refuses private ones", async () => {
    const fetchMock = vi.fn(
      async () => new Response(null, { status: 302, headers: { location: "http://127.0.0.1/admin" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(safeFetch("https://93.184.216.34/start")).rejects.toMatchObject({ code: "blocked_address" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("enforces the byte cap", async () => {
    const fetchMock = vi.fn(async () => new Response("0123456789", { headers: { "content-type": "text/plain" } }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(safeFetch("https://93.184.216.34/big", { maxBytes: 4 })).rejects.toMatchObject({ code: "too_large" });
  });

  it("throws on error statuses unless allowed", async () => {
    const fetchMock = vi.fn(async () => new Response("nope", { status: 404 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(safeFetch("https://93.184.216.34/missing")).rejects.toMatchObject({ code: "http_error" });
  });
});
