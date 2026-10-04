import type { YoutubeIntegrationStatus } from "@studium/shared";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { EngineInstallError } from "../youtube/update.js";
import { type YoutubeAdminService, youtubeRoutes } from "./youtube.js";

const STATUS: YoutubeIntegrationStatus = {
  engine: {
    state: "missing",
    source: null,
    version: null,
    asset: "yt-dlp_linux",
    platformSupported: true,
    platformLabel: "linux x86_64",
    nodePresent: true,
    managedInstalled: false,
    managedVersion: null,
    managedShadowed: false,
    envOverrideInvalid: false,
  },
  cookies: {
    source: "none",
    configured: false,
    readable: false,
    stale: false,
    lastSuccessAt: null,
    lastSuccessVideoId: null,
  },
  mode: "basic",
  modeLabel: "Transcripts: basic",
  updateRecommended: false,
};

function fakeService(overrides: Partial<YoutubeAdminService> = {}): YoutubeAdminService {
  return {
    status: vi.fn(async () => STATUS),
    install: vi.fn(async () => STATUS),
    update: vi.fn(async () => STATUS),
    uploadCookies: vi.fn(async () => STATUS),
    removeCookies: vi.fn(async () => STATUS),
    ...overrides,
  };
}

function appFor(service: YoutubeAdminService): Hono {
  const app = new Hono();
  app.route("/api/admin/youtube", youtubeRoutes({ service }));
  return app;
}

function upload(body: Blob | string, filename = "cookies.txt") {
  const form = new FormData();
  form.set("file", body instanceof Blob ? body : new Blob([body]), filename);
  return form;
}

describe("youtube admin routes", () => {
  it("returns the status object without any secret material", async () => {
    const app = appFor(fakeService());
    const response = await app.request("/api/admin/youtube/status");
    expect(response.status).toBe(200);
    const body = (await response.json()) as Record<string, unknown>;
    const serialized = JSON.stringify(body);
    expect(serialized).not.toMatch(/secret|enc:|SID/i);
    expect(serialized).not.toMatch(/\/home\/|\/data\//);
  });

  it("rejects a non-Netscape upload with the owner's friendly copy", async () => {
    const service = fakeService();
    const app = appFor(service);
    const response = await app.request("/api/admin/youtube/cookies", {
      method: "POST",
      body: upload("hello, not a cookies file"),
    });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "This doesn't look like a cookies.txt export — it should start with `# Netscape HTTP Cookie File`",
    });
    expect(service.uploadCookies).not.toHaveBeenCalled();
  });

  it("accepts a valid Netscape upload", async () => {
    const service = fakeService();
    const app = appFor(service);
    const response = await app.request("/api/admin/youtube/cookies", {
      method: "POST",
      body: upload("# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tsecret\n"),
    });
    expect(response.status).toBe(200);
    expect(service.uploadCookies).toHaveBeenCalledWith(expect.stringContaining("secret"));
  });

  it("bounds an oversized upload before buffering", async () => {
    const service = fakeService();
    const app = new Hono();
    app.route("/api/admin/youtube", youtubeRoutes({ service, maxCookieBytes: 64 }));
    const response = await app.request("/api/admin/youtube/cookies", {
      method: "POST",
      body: upload(`# Netscape HTTP Cookie File\n${"x".repeat(200)}\n`),
    });
    expect(response.status).toBe(413);
    expect(service.uploadCookies).not.toHaveBeenCalled();
  });

  it("reports an unsupported platform instead of failing", async () => {
    const service = fakeService({
      install: vi.fn(async () => {
        throw new EngineInstallError("yt-dlp is not available on this server.");
      }),
    });
    const response = await appFor(service).request("/api/admin/youtube/install", { method: "POST" });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "yt-dlp is not available on this server." });
  });

  it("never surfaces a raw install error", async () => {
    const service = fakeService({
      update: vi.fn(async () => {
        throw new Error("ECONNRESET at /home/operator/secret");
      }),
    });
    const response = await appFor(service).request("/api/admin/youtube/update", { method: "POST" });
    expect(response.status).toBe(502);
    const body = (await response.json()) as { error: string };
    expect(body.error).not.toContain("ECONNRESET");
    expect(body.error).not.toContain("/home/operator");
  });

  it("removes only uploaded credentials and explains env-provided ones", async () => {
    const service = fakeService();
    const app = appFor(service);
    expect((await app.request("/api/admin/youtube/cookies", { method: "DELETE" })).status).toBe(200);
    expect(service.removeCookies).toHaveBeenCalledTimes(1);

    const envService = fakeService({
      status: vi.fn(
        async (): Promise<YoutubeIntegrationStatus> => ({
          ...STATUS,
          cookies: { ...STATUS.cookies, source: "env", configured: true },
        }),
      ),
    });
    const envResponse = await appFor(envService).request("/api/admin/youtube/cookies", { method: "DELETE" });
    expect(envResponse.status).toBe(409);
    expect(envService.removeCookies).not.toHaveBeenCalled();
  });
});
