import type { YoutubeIntegrationStatus } from "@studium/shared";
import { type Context, Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { COOKIES_MAX_BYTES, CookieValidationError, validateCookies } from "../youtube/cookies.js";
import { EngineInstallError, PLATFORM_UNSUPPORTED_MESSAGE } from "../youtube/update.js";

/** Multipart framing (boundary + headers) allowed on top of the 1 MiB cap. */
const COOKIE_UPLOAD_OVERHEAD_BYTES = 64 * 1024;

/** The slice of the YouTube integration the admin routes need (fakeable). */
export interface YoutubeAdminService {
  status(): Promise<YoutubeIntegrationStatus>;
  install(): Promise<YoutubeIntegrationStatus>;
  update(): Promise<YoutubeIntegrationStatus>;
  uploadCookies(plaintext: string): Promise<YoutubeIntegrationStatus>;
  removeCookies(): Promise<YoutubeIntegrationStatus>;
}

export interface YoutubeRoutesDeps {
  service: YoutubeAdminService;
  /** Overridable for tests; defaults to the 1 MiB cookie cap. */
  maxCookieBytes?: number;
}

async function readCookieFile(c: Context, maxBytes: number): Promise<string | Response> {
  let form: Record<string, string | File | (string | File)[]>;
  try {
    form = await c.req.parseBody({ all: true });
  } catch {
    return c.json({ error: "invalid multipart body" }, 400);
  }
  const files: File[] = [];
  for (const value of Object.values(form)) {
    if (Array.isArray(value)) {
      for (const item of value) if (typeof item !== "string") files.push(item);
    } else if (typeof value !== "string") {
      files.push(value);
    }
  }
  const file = files[0];
  if (file === undefined) return c.json({ error: "A cookies.txt file is required." }, 400);
  if (file.size > maxBytes) return c.json({ error: "This cookies.txt file is too large — keep it under 1 MB." }, 413);
  return await file.text();
}

export function youtubeRoutes(deps: YoutubeRoutesDeps): Hono {
  const maxCookieBytes = deps.maxCookieBytes ?? COOKIES_MAX_BYTES;
  const app = new Hono();

  app.get("/status", async (c) => c.json(await deps.service.status()));

  app.post("/install", async (c) => {
    try {
      return c.json(await deps.service.install());
    } catch (error) {
      if (error instanceof EngineInstallError) {
        return c.json(
          { error: error.message === PLATFORM_UNSUPPORTED_MESSAGE ? error.message : friendlyInstallError() },
          error.message === PLATFORM_UNSUPPORTED_MESSAGE ? 400 : 502,
        );
      }
      return c.json({ error: friendlyInstallError() }, 502);
    }
  });

  app.post("/update", async (c) => {
    try {
      return c.json(await deps.service.update());
    } catch (error) {
      if (error instanceof EngineInstallError) {
        return c.json(
          { error: error.message === PLATFORM_UNSUPPORTED_MESSAGE ? error.message : friendlyInstallError() },
          error.message === PLATFORM_UNSUPPORTED_MESSAGE ? 400 : 502,
        );
      }
      return c.json({ error: friendlyInstallError() }, 502);
    }
  });

  app.post(
    "/cookies",
    bodyLimit({
      maxSize: maxCookieBytes + COOKIE_UPLOAD_OVERHEAD_BYTES,
      onError: (c) => c.json({ error: "This cookies.txt file is too large — keep it under 1 MB." }, 413),
    }),
    async (c) => {
      const parsed = await readCookieFile(c, maxCookieBytes);
      if (parsed instanceof Response) return parsed;
      const byteLength = Buffer.byteLength(parsed, "utf8");
      if (byteLength > maxCookieBytes) {
        return c.json({ error: "This cookies.txt file is too large — keep it under 1 MB." }, 413);
      }
      try {
        validateCookies(parsed, byteLength);
      } catch (error) {
        if (error instanceof CookieValidationError) return c.json({ error: error.message }, 400);
        return c.json({ error: "The cookies.txt file could not be validated." }, 400);
      }
      return c.json(await deps.service.uploadCookies(parsed));
    },
  );

  app.delete("/cookies", async (c) => {
    const status = await deps.service.status();
    if (status.cookies.source === "env") {
      return c.json({ error: "Cookies are provided by this server's environment, not an upload." }, 409);
    }
    return c.json(await deps.service.removeCookies());
  });

  return app;
}

function friendlyInstallError(): string {
  return "Couldn't install yt-dlp. The download was not verified, so nothing was changed.";
}
