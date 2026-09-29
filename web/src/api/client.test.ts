import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, api, UnauthorizedError } from "./client";

describe("api client", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("signin posts JSON credentials", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ user: { username: "alice" } }), { status: 200 }));

    await api.auth.signin("alice", "hunter2");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/signin");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({ "Content-Type": "application/json" });
    expect(JSON.parse(init.body as string)).toEqual({ username: "alice", password: "hunter2" });
  });

  it("status hits the public status endpoint", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ setupRequired: false, disallowPasswordAuth: false, instanceUrl: "" }), {
        status: 200,
      }),
    );

    const status = await api.auth.status();

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/auth/status");
    expect(status.setupRequired).toBe(false);
  });

  it("setup posts the admin credentials and optional setup code", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ user: { username: "admin" } }), { status: 201 }));

    await api.auth.setup({ username: "admin", password: "hunter22", setupCode: "abc123" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/auth/setup");
    expect(JSON.parse(init.body as string)).toEqual({ username: "admin", password: "hunter22", setupCode: "abc123" });
  });

  it("me.createAccessToken posts to /api/me/access-tokens", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "tok_1", token: "studium_pat_x" }), { status: 201 }));

    await api.me.createAccessToken({ description: "CLI" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/me/access-tokens");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string)).toEqual({ description: "CLI" });
  });

  it("admin.deleteUser adds ?purge=1 when purging", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response(null, { status: 204 }));

    await api.admin.deleteUser(7, { purge: true });

    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/admin/users/7?purge=1");
  });

  it("raises UnauthorizedError on a 401 response", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 }));

    await expect(api.sets.list()).rejects.toBeInstanceOf(UnauthorizedError);
  });

  it("raises ApiError with the response body on other failures", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ error: "invalid credentials" }), { status: 429 }));

    await expect(api.auth.signin("alice", "wrong")).rejects.toBeInstanceOf(ApiError);
  });

  it("resolves parsed JSON on success", async () => {
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    fetchMock.mockResolvedValue(new Response(JSON.stringify([{ slug: "linear-algebra" }]), { status: 200 }));

    const sets = await api.sets.list();
    expect(sets).toEqual([{ slug: "linear-algebra" }]);
  });
});
