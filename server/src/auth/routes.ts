import { createHash, timingSafeEqual } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { type Context, Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { createSession, revokeSession } from "../accounts/sessions.js";
import { getInstanceSettings } from "../accounts/settings.js";
import { createUser, getUserByUsername, listUsers, verifyUserPassword } from "../accounts/users.js";
import { SESSION_COOKIE, sessionAuth } from "./middleware.js";
import { verifyPassword } from "./password.js";

const SESSION_MAX_AGE_SECONDS = 30 * 24 * 60 * 60;
const RATE_LIMIT_WINDOW_MS = 15 * 60 * 1_000;
const MAX_FAILED_LOGINS = 5;
const MAX_RATE_LIMIT_BUCKETS = 10_000;
const DUMMY_PASSWORD_HASH =
  "scrypt$16384$8$1$mkDNTe7wUqW-XrisY1C-0Q$zSvOGGkUGBzt8zqVkCr4g6NuiezCIh0ijjLqiGwiMKngz6QfaYC_NyzRZ5oyfyoG1CgDnKuC2rEoVArZjQR0gA";

export interface AuthRouteOptions {
  db: DatabaseSync;
  trustProxy: boolean;
  baseUrl: string | null;
  setupCode: string | null;
}

interface LoginAttempt {
  failures: number;
  startedAt: number;
}

function constantTimeEqual(left: string, right: string): boolean {
  const leftDigest = createHash("sha256").update(left).digest();
  const rightDigest = createHash("sha256").update(right).digest();
  return timingSafeEqual(leftDigest, rightDigest) && left.length === right.length;
}

function requestIsHttps(c: Context, options: AuthRouteOptions): boolean {
  if (new URL(c.req.url).protocol === "https:" || options.baseUrl?.toLowerCase().startsWith("https://")) return true;
  const proto = c.req.header("x-forwarded-proto")?.split(",", 1)[0]?.trim().toLowerCase();
  return options.trustProxy && proto === "https";
}

function clientIp(c: Context, trustProxy: boolean): string {
  if (trustProxy) {
    const forwarded = c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim();
    if (forwarded) return forwarded;
  }
  const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? "unknown";
}

function cookieOptions(c: Context, options: AuthRouteOptions) {
  return {
    httpOnly: true,
    sameSite: "Strict" as const,
    path: "/",
    secure: requestIsHttps(c, options),
  };
}

function setSessionCookie(c: Context, options: AuthRouteOptions, token: string): void {
  setCookie(c, SESSION_COOKIE, token, { ...cookieOptions(c, options), maxAge: SESSION_MAX_AGE_SECONDS });
}

function pruneExpiredAttempts(attempts: Map<string, LoginAttempt>, now: number): void {
  for (const [ip, attempt] of attempts) {
    if (now - attempt.startedAt >= RATE_LIMIT_WINDOW_MS) attempts.delete(ip);
  }
}

function addFailedAttempt(attempts: Map<string, LoginAttempt>, ip: string, now: number): void {
  const current = attempts.get(ip);
  if (current !== undefined) {
    current.failures += 1;
    return;
  }
  if (attempts.size >= MAX_RATE_LIMIT_BUCKETS) {
    const oldest = attempts.keys().next().value;
    if (oldest !== undefined) attempts.delete(oldest);
  }
  attempts.set(ip, { failures: 1, startedAt: now });
}

async function jsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function authRoutes(options: AuthRouteOptions): Hono {
  const { db } = options;
  const app = new Hono();
  const attempts = new Map<string, LoginAttempt>();
  let setupInProgress = false;

  app.get("/status", (c) => {
    const settings = getInstanceSettings(db);
    return c.json({ setupRequired: listUsers(db).length === 0, ...settings });
  });

  app.post("/setup", async (c) => {
    if (setupInProgress || listUsers(db).length !== 0) return c.json({ error: "setup is already complete" }, 409);
    setupInProgress = true;
    try {
      const body = await jsonBody(c);
      const username = typeof body?.username === "string" ? body.username : "";
      const password = typeof body?.password === "string" ? body.password : "";
      const suppliedCode = typeof body?.setupCode === "string" ? body.setupCode : "";
      if (options.setupCode !== null && !constantTimeEqual(suppliedCode, options.setupCode)) {
        return c.json({ error: "invalid setup code" }, 403);
      }
      if (password.length < 8) return c.json({ error: "password must be at least 8 characters" }, 400);
      const user = await createUser(db, { username, password, role: "ADMIN" });
      const session = createSession(db, user.id, {
        userAgent: c.req.header("user-agent") ?? "",
        ip: clientIp(c, options.trustProxy),
      });
      setSessionCookie(c, options, session.token);
      return c.json({ user }, 201);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "invalid account" }, 400);
    } finally {
      setupInProgress = false;
    }
  });

  const signin = async (c: Context) => {
    const now = Date.now();
    pruneExpiredAttempts(attempts, now);
    const ip = clientIp(c, options.trustProxy);
    const attempt = attempts.get(ip);
    if (attempt !== undefined && attempt.failures >= MAX_FAILED_LOGINS) {
      return c.json({ error: "too many attempts" }, 429);
    }

    const body = await jsonBody(c);
    const username = typeof body?.username === "string" ? body.username : "";
    const password = typeof body?.password === "string" ? body.password : "";
    const user = getUserByUsername(db, username);
    if (
      user !== null &&
      user.state === "NORMAL" &&
      user.role !== "ADMIN" &&
      getInstanceSettings(db).disallowPasswordAuth
    ) {
      return c.json({ error: "password sign-in is disabled" }, 403);
    }
    const passwordValid =
      user !== null && user.state === "NORMAL" && user.hasPassword
        ? await verifyUserPassword(db, user.id, password)
        : await verifyPassword(password, DUMMY_PASSWORD_HASH);
    const valid = user !== null && user.state === "NORMAL" && passwordValid;
    if (!valid || user === null) {
      addFailedAttempt(attempts, ip, now);
      return c.json({ error: "invalid credentials" }, 401);
    }

    attempts.delete(ip);
    const session = createSession(db, user.id, { userAgent: c.req.header("user-agent") ?? "", ip });
    setSessionCookie(c, options, session.token);
    return c.json({ user });
  };

  app.post("/signin", signin);
  app.post("/login", signin);

  app.use("/signout", sessionAuth(db));
  app.use("/logout", sessionAuth(db));
  const signout = (c: Context) => {
    const sessionId = c.get("sessionId");
    if (sessionId !== null) revokeSession(db, c.get("user").id, sessionId);
    deleteCookie(c, SESSION_COOKIE, cookieOptions(c, options));
    return c.body(null, 204);
  };
  app.post("/signout", signout);
  app.post("/logout", signout);

  app.use("/me", sessionAuth(db));
  app.get("/me", (c) => {
    const user = c.get("user");
    return c.json({ user, username: user.username });
  });

  return app;
}
