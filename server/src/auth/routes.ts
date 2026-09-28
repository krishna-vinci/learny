import { createHash, timingSafeEqual } from "node:crypto";
import { type Context, Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { verifyPassword } from "./password.js";
import { type AuthConfig, signSession, verifySession } from "./session.js";

declare module "hono" {
  interface ContextVariableMap {
    username: string;
  }
}

const SESSION_COOKIE = "studium_session";
const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
const MAX_FAILED_LOGINS = 5;

interface LoginAttempt {
  failures: number;
  startedAt: number;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest) && left.length === right.length;
}

function requestIsHttps(c: Context): boolean {
  const forwardedProto = c.req.header("x-forwarded-proto")?.split(",", 1)[0]?.trim().toLowerCase();
  return forwardedProto === "https" || new URL(c.req.url).protocol === "https:";
}

function clientIp(c: Context): string {
  const forwardedFor = c.req.header("x-forwarded-for")?.split(",", 1)[0]?.trim();
  if (forwardedFor) {
    return forwardedFor;
  }

  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } };
  return env.incoming?.socket?.remoteAddress ?? "unknown";
}

function cookieOptions(c: Context) {
  return {
    httpOnly: true,
    sameSite: "Strict" as const,
    path: "/",
    secure: requestIsHttps(c),
  };
}

function bearerToken(authorization: string | undefined): string | null {
  const match = authorization?.match(/^Bearer ([^\s]+)$/i);
  return match?.[1] ?? null;
}

export function requireAuth(cfg: AuthConfig): MiddlewareHandler {
  return async (c, next) => {
    if (cfg.passwordHash === null) {
      c.set("username", "local");
      await next();
      return;
    }

    const suppliedToken = bearerToken(c.req.header("authorization"));
    if (cfg.apiToken !== null && suppliedToken !== null && constantTimeEqual(suppliedToken, cfg.apiToken)) {
      c.set("username", cfg.username ?? "local");
      await next();
      return;
    }

    const sessionToken = getCookie(c, SESSION_COOKIE);
    const username =
      sessionToken !== undefined && cfg.sessionSecret !== null ? verifySession(sessionToken, cfg.sessionSecret) : null;
    if (username !== null) {
      c.set("username", username);
      await next();
      return;
    }

    return c.json({ error: "unauthorized" }, 401);
  };
}

export function authRoutes(cfg: AuthConfig): Hono {
  const app = new Hono();
  const attempts = new Map<string, LoginAttempt>();

  app.post("/login", async (c) => {
    if (cfg.passwordHash === null) {
      return c.body(null, 204);
    }

    const ip = clientIp(c);
    const now = Date.now();
    const attempt = attempts.get(ip);
    if (
      attempt !== undefined &&
      now - attempt.startedAt < RATE_LIMIT_WINDOW_MS &&
      attempt.failures >= MAX_FAILED_LOGINS
    ) {
      return c.json({ error: "too many attempts" }, 429);
    }
    if (attempt !== undefined && now - attempt.startedAt >= RATE_LIMIT_WINDOW_MS) {
      attempts.delete(ip);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      body = null;
    }
    const username =
      typeof body === "object" && body !== null && "username" in body && typeof body.username === "string"
        ? body.username
        : "";
    const password =
      typeof body === "object" && body !== null && "password" in body && typeof body.password === "string"
        ? body.password
        : "";

    const configuredUsername = cfg.username;
    const passwordValid = await verifyPassword(password, cfg.passwordHash);
    const usernameValid = configuredUsername !== null && constantTimeEqual(username, configuredUsername);
    if (!passwordValid || !usernameValid || configuredUsername === null || cfg.sessionSecret === null) {
      const current = attempts.get(ip);
      if (current === undefined) {
        attempts.set(ip, { failures: 1, startedAt: now });
      } else {
        current.failures += 1;
      }
      return c.json({ error: "invalid credentials" }, 401);
    }

    attempts.delete(ip);
    setCookie(c, SESSION_COOKIE, signSession(configuredUsername, cfg.sessionSecret), {
      ...cookieOptions(c),
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return c.body(null, 204);
  });

  app.use("/logout", requireAuth(cfg));
  app.post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, cookieOptions(c));
    return c.body(null, 204);
  });

  app.use("/me", requireAuth(cfg));
  app.get("/me", (c) => c.json({ username: c.get("username") }));

  return app;
}
