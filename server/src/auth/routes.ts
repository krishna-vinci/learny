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
const MAX_RATE_LIMIT_BUCKETS = 10_000;

interface LoginAttempt {
  failures: number;
  startedAt: number;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest) && left.length === right.length;
}

function requestIsHttps(c: Context, cfg: AuthConfig): boolean {
  if (new URL(c.req.url).protocol === "https:" || cfg.baseUrl?.toLowerCase().startsWith("https://")) {
    return true;
  }

  const forwardedProto = c.req.header("x-forwarded-proto")?.split(",", 1)[0]?.trim().toLowerCase();
  return cfg.trustProxy && forwardedProto === "https";
}

function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwardedFor = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (forwardedFor) {
      return forwardedFor;
    }
  }

  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? "unknown";
}

function cookieOptions(c: Context, cfg: AuthConfig) {
  return {
    httpOnly: true,
    sameSite: "Strict" as const,
    path: "/",
    secure: requestIsHttps(c, cfg),
  };
}

function sessionSigningKey(cfg: AuthConfig): string | null {
  if (cfg.sessionSecret === null || cfg.passwordHash === null) {
    return null;
  }
  return `${cfg.sessionSecret}\n${cfg.passwordHash}`;
}

function pruneExpiredAttempts(attempts: Map<string, LoginAttempt>, now: number): void {
  for (const [ip, attempt] of attempts) {
    if (now - attempt.startedAt >= RATE_LIMIT_WINDOW_MS) {
      attempts.delete(ip);
    }
  }
}

function addFailedAttempt(attempts: Map<string, LoginAttempt>, ip: string, now: number): void {
  const current = attempts.get(ip);
  if (current !== undefined) {
    current.failures += 1;
    return;
  }

  if (attempts.size >= MAX_RATE_LIMIT_BUCKETS) {
    const oldestIp = attempts.keys().next().value;
    if (oldestIp !== undefined) {
      attempts.delete(oldestIp);
    }
  }
  attempts.set(ip, { failures: 1, startedAt: now });
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
    const signingKey = sessionSigningKey(cfg);
    const username = sessionToken !== undefined && signingKey !== null ? verifySession(sessionToken, signingKey) : null;
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

    const now = Date.now();
    pruneExpiredAttempts(attempts, now);

    const ip = clientIp(c, cfg.trustProxy);
    const attempt = attempts.get(ip);
    if (attempt !== undefined && attempt.failures >= MAX_FAILED_LOGINS) {
      return c.json({ error: "too many attempts" }, 429);
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
      addFailedAttempt(attempts, ip, now);
      return c.json({ error: "invalid credentials" }, 401);
    }

    attempts.delete(ip);
    const signingKey = sessionSigningKey(cfg);
    if (signingKey === null) {
      return c.json({ error: "invalid credentials" }, 401);
    }
    setCookie(c, SESSION_COOKIE, signSession(configuredUsername, signingKey), {
      ...cookieOptions(c, cfg),
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return c.body(null, 204);
  });

  app.use("/logout", requireAuth(cfg));
  app.post("/logout", (c) => {
    deleteCookie(c, SESSION_COOKIE, cookieOptions(c, cfg));
    return c.body(null, 204);
  });

  app.use("/me", requireAuth(cfg));
  app.get("/me", (c) => c.json({ username: c.get("username") }));

  return app;
}
