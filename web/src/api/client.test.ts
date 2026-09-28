import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, UnauthorizedError } from "./client";

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("login posts JSON credentials", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await api.auth.login("alice", "hunter2");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/login");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ username: "alice", password: "hunter2" });
  });

  it("raises UnauthorizedError on a 401 response", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));

    await expect(api.sets.list()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("raises ApiError with the response body on other failures", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "invalid credentials" }), { status: 429 }));

    await expect(api.auth.login("alice", "wrong")).rejects.toBeInstanceOf(ApiError);
  });

  it("resolves parsed JSON on success", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ slug: "linear-algebra" }]), { status: 200 }));

    const sets = await api.sets.list();
    expect(sets).toEqual([{ slug: "linear-algebra" }]);
  });
});
