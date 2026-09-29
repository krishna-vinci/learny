import type { MiddlewareHandler } from "hono";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const SAME_SITE_VALUES = new Set(["same-origin", "none"]);

interface ParsedHost {
  hostname: string;
  host: string;
}

function parseHost(value: string | undefined): ParsedHost | null {
  if (value === undefined) {
    return null;
  }

  try {
    const parsed = new URL(`http://${value}`);
    if (
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return null;
    }
    return { hostname: parsed.hostname, host: value.trim().toLowerCase() };
  } catch {
    return null;
  }
}

function parseOriginHost(value: string): string | null {
  try {
    const parsed = new URL(value);
    if (
      parsed.origin === "null" ||
      parsed.username !== "" ||
      parsed.password !== "" ||
      parsed.pathname !== "/" ||
      parsed.search !== "" ||
      parsed.hash !== ""
    ) {
      return null;
    }
    return parsed.host.toLowerCase();
  } catch {
    return null;
  }
}

export function requestGuard(): MiddlewareHandler {
  return async (c, next) => {
    const requestHost = parseHost(c.req.header("host"));
    if (!SAFE_METHODS.has(c.req.method)) {
      const fetchSite = c.req.header("sec-fetch-site")?.trim().toLowerCase();
      if (fetchSite !== undefined && !SAME_SITE_VALUES.has(fetchSite)) {
        return c.json({ error: "cross-site request" }, 403);
      }

      const origin = c.req.header("origin");
      if (origin !== undefined) {
        if (requestHost === null || parseOriginHost(origin) !== requestHost.host) {
          return c.json({ error: "cross-site request" }, 403);
        }
      }
    }

    await next();
  };
}
