import type { DatabaseSync } from "node:sqlite";
import type { MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import { resolveSession } from "../accounts/sessions.js";
import { ACCESS_TOKEN_PREFIX, resolveAccessToken } from "../accounts/tokens.js";
import type { User } from "../accounts/users.js";

declare module "hono" {
  interface ContextVariableMap {
    user: User;
    sessionId: string | null;
  }
}

export const SESSION_COOKIE = "studium_session";

export function sessionAuth(db: DatabaseSync): MiddlewareHandler {
  return async (c, next) => {
    const authorization = c.req.header("authorization");
    const bearer = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
    if (bearer?.startsWith(ACCESS_TOKEN_PREFIX)) {
      const resolved = resolveAccessToken(db, bearer);
      if (resolved !== null) {
        c.set("user", resolved.user);
        c.set("sessionId", null);
        await next();
        return;
      }
      return c.json({ error: "unauthorized" }, 401);
    }

    const token = getCookie(c, SESSION_COOKIE);
    if (token !== undefined) {
      const resolved = resolveSession(db, token);
      if (resolved !== null) {
        c.set("user", resolved.user);
        c.set("sessionId", resolved.session.id);
        await next();
        return;
      }
    }
    return c.json({ error: "unauthorized" }, 401);
  };
}

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  if (c.get("user").role !== "ADMIN") return c.json({ error: "forbidden" }, 403);
  await next();
};
