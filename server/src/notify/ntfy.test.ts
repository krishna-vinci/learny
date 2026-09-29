import { describe, expect, it, vi } from "vitest";
import { sendNtfy, validNtfyUrl } from "./ntfy.js";

describe("ntfy", () => {
  it("posts the body with title, click, tags and token headers", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response("", { status: 200 }));
    await sendNtfy(
      { url: "https://ntfy.sh/studium-test", token: "tk_123" },
      { title: "Job finished", body: "Draft ready", url: "https://notes.example/s/linear-algebra", tags: ["bell"] },
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const call = fetchImpl.mock.calls[0] as [string, RequestInit | undefined];
    expect(call[0]).toBe("https://ntfy.sh/studium-test");
    expect(call[1]?.method).toBe("POST");
    expect(call[1]?.headers).toMatchObject({
      Title: "Job finished",
      Click: "https://notes.example/s/linear-algebra",
      Tags: "bell",
      Authorization: "Bearer tk_123",
    });
    expect(call[1]?.body).toBe("Draft ready");
  });

  it("omits Click and Authorization when there is no url or token", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response("", { status: 200 }));
    await sendNtfy(
      { url: "https://ntfy.sh/x" },
      { title: "t", body: "b" },
      {
        fetchImpl: fetchImpl as unknown as typeof fetch,
      },
    );
    const call = fetchImpl.mock.calls[0] as [string, RequestInit | undefined];
    expect(call[1]?.headers).not.toHaveProperty("Click");
    expect(call[1]?.headers).not.toHaveProperty("Authorization");
    expect(call[1]?.headers).toMatchObject({ Tags: "bell" });
  });

  it("throws on a non-ok response", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) => new Response("nope", { status: 500 }));
    await expect(
      sendNtfy(
        { url: "https://ntfy.sh/x" },
        { title: "t", body: "b" },
        {
          fetchImpl: fetchImpl as unknown as typeof fetch,
        },
      ),
    ).rejects.toThrow("500");
  });

  it("validates topic urls", () => {
    expect(validNtfyUrl("https://ntfy.sh/topic")).toBe(true);
    expect(validNtfyUrl("http://192.168.0.10:8080/topic")).toBe(true);
    expect(validNtfyUrl("ftp://ntfy.sh/topic")).toBe(false);
    expect(validNtfyUrl("not a url")).toBe(false);
  });
});
