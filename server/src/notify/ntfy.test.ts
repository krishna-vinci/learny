import { describe, expect, it, vi } from "vitest";
import type { safeFetch } from "../ingest/safe-fetch.js";
import { sendNtfy, validNtfyUrl } from "./ntfy.js";

function safeResponse(status = 200) {
  return {
    url: "https://ntfy.sh/topic",
    status,
    ok: status >= 200 && status < 300,
    headers: new Headers(),
    contentType: null,
    bytes: new Uint8Array(),
  };
}

describe("ntfy", () => {
  it("posts the body with title, click, tags and token headers", async () => {
    const safeFetchImpl = vi.fn<typeof safeFetch>(async () => safeResponse());
    await sendNtfy(
      { url: "https://ntfy.sh/studium-test", token: "tk_123" },
      { title: "Job finished", body: "Draft ready", url: "https://notes.example/s/linear-algebra", tags: ["bell"] },
      { safeFetchImpl: safeFetchImpl as unknown as typeof safeFetch },
    );

    expect(safeFetchImpl).toHaveBeenCalledTimes(1);
    const call = safeFetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    if (call === undefined) throw new Error("safeFetch was not called");
    expect(call[0]).toBe("https://ntfy.sh/studium-test");
    expect(call[1]?.method).toBe("POST");
    expect(call[1]?.headers).toMatchObject({
      Title: "Job finished",
      Click: "https://notes.example/s/linear-algebra",
      Tags: "bell",
      Authorization: "Bearer tk_123",
    });
    expect(call[1]?.body).toBe("Draft ready");
    expect(call[1]).toMatchObject({ timeoutMs: 5_000, maxBytes: 16 * 1024, allowErrorStatus: true });
  });

  it("omits Click and Authorization when there is no url or token", async () => {
    const safeFetchImpl = vi.fn<typeof safeFetch>(async () => safeResponse());
    await sendNtfy(
      { url: "https://ntfy.sh/x" },
      { title: "t", body: "b" },
      {
        safeFetchImpl: safeFetchImpl as unknown as typeof safeFetch,
      },
    );
    const call = safeFetchImpl.mock.calls[0];
    expect(call).toBeDefined();
    if (call === undefined) throw new Error("safeFetch was not called");
    expect(call[1]?.headers).not.toHaveProperty("Click");
    expect(call[1]?.headers).not.toHaveProperty("Authorization");
    expect(call[1]?.headers).toMatchObject({ Tags: "bell" });
  });

  it("throws on a non-ok response", async () => {
    const safeFetchImpl = vi.fn<typeof safeFetch>(async () => safeResponse(500));
    await expect(
      sendNtfy(
        { url: "https://ntfy.sh/x" },
        { title: "t", body: "b" },
        {
          safeFetchImpl: safeFetchImpl as unknown as typeof safeFetch,
        },
      ),
    ).rejects.toThrow("500");
  });

  it("lets admins post to private HTTP topics without following redirects", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    await sendNtfy(
      { url: "http://192.168.0.55/topic" },
      { title: "t", body: "b" },
      { fetchImpl: fetchImpl as unknown as typeof fetch, isAdmin: true },
    );
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://192.168.0.55/topic",
      expect.objectContaining({ method: "POST", redirect: "error" }),
    );
  });

  it("validates topic urls", () => {
    expect(validNtfyUrl("https://ntfy.sh/topic")).toBe(true);
    expect(validNtfyUrl("http://192.168.0.10:8080/topic")).toBe(true);
    expect(validNtfyUrl("ftp://ntfy.sh/topic")).toBe(false);
    expect(validNtfyUrl("not a url")).toBe(false);
  });
});
