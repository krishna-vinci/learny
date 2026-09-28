import { createHmac, timingSafeEqual } from "node:crypto";

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1_000;
const LOCAL_HOSTS = new Set(["127.0.0.1", "::1", "localhost"]);

export interface AuthConfig {
  username: string | null;
  passwordHash: string | null;
  sessionSecret: string | null;
  apiToken: string | null;
  trustProxy: boolean;
  baseUrl: string | null;
}

function envValue(value: string | undefined): string | null {
  return value === undefined || value.length === 0 ? null : value;
}

export function authConfigFromEnv(env: NodeJS.ProcessEnv): AuthConfig {
  return {
    username: envValue(env.STUDIUM_USERNAME),
    passwordHash: envValue(env.STUDIUM_PASSWORD_HASH),
    sessionSecret: envValue(env.STUDIUM_SESSION_SECRET),
    apiToken: envValue(env.STUDIUM_API_TOKEN),
    trustProxy: env.STUDIUM_TRUST_PROXY === "1" || env.STUDIUM_TRUST_PROXY === "true",
    baseUrl: envValue(env.STUDIUM_BASE_URL),
  };
}

export function assertBindAllowed(cfg: AuthConfig, host: string): void {
  if (cfg.passwordHash === null && !LOCAL_HOSTS.has(host)) {
    throw new Error("a password is required when binding outside localhost");
  }
  if (cfg.passwordHash !== null && (cfg.sessionSecret === null || cfg.sessionSecret.length < 32)) {
    throw new Error("STUDIUM_SESSION_SECRET must be at least 32 characters when a password is configured");
  }
}

function signature(payload: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(payload).digest();
}

function decodeSignature(value: string): Buffer | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) {
    return null;
  }
  const decoded = Buffer.from(value, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== value) {
    return null;
  }
  return decoded;
}

export function signSession(username: string, secret: string, now = Date.now()): string {
  const payload = Buffer.from(JSON.stringify({ u: username, exp: now + SESSION_DURATION_MS })).toString("base64url");
  return `${payload}.${signature(payload, secret).toString("base64url")}`;
}

export function verifySession(token: string, secret: string, now = Date.now()): string | null {
  const parts = token.split(".");
  if (parts.length !== 2) {
    return null;
  }

  const payload = parts[0] ?? "";
  const actualSignature = decodeSignature(parts[1] ?? "");
  if (payload.length === 0 || actualSignature === null) {
    return null;
  }

  const expectedSignature = signature(payload, secret);
  if (!timingSafeEqual(actualSignature, expectedSignature)) {
    return null;
  }

  try {
    const decodedPayload = Buffer.from(payload, "base64url");
    if (decodedPayload.toString("base64url") !== payload) {
      return null;
    }
    const value: unknown = JSON.parse(decodedPayload.toString("utf8"));
    if (
      typeof value !== "object" ||
      value === null ||
      !("u" in value) ||
      !("exp" in value) ||
      typeof value.u !== "string" ||
      typeof value.exp !== "number" ||
      !Number.isSafeInteger(value.exp) ||
      value.exp <= now
    ) {
      return null;
    }
    return value.u;
  } catch {
    return null;
  }
}
