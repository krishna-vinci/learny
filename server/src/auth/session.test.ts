import { describe, expect, it } from "vitest";
import { type AuthConfig, assertBindAllowed, authConfigFromEnv, signSession, verifySession } from "./session.js";

const protectedConfig: AuthConfig = {
  username: "learner",
  passwordHash: "hash",
  sessionSecret: "a-secure-session-secret-at-least-32-chars",
  apiToken: null,
  trustProxy: false,
  baseUrl: null,
};

describe("session tokens", () => {
  it("signs a session that remains valid for 30 days", () => {
    const now = 1_700_000_000_000;
    const token = signSession("learner", protectedConfig.sessionSecret ?? "", now);

    expect(verifySession(token, protectedConfig.sessionSecret ?? "", now + 30 * 24 * 60 * 60 * 1_000 - 1)).toBe(
      "learner",
    );
    expect(verifySession(token, protectedConfig.sessionSecret ?? "", now + 30 * 24 * 60 * 60 * 1_000)).toBeNull();
  });

  it("rejects tampered and malformed sessions", () => {
    const secret = protectedConfig.sessionSecret ?? "";
    const token = signSession("learner", secret, 1_700_000_000_000);
    const [payload, signature] = token.split(".");

    expect(verifySession(`${payload}x.${signature}`, secret, 1_700_000_000_001)).toBeNull();
    expect(verifySession("malformed", secret, 1_700_000_000_001)).toBeNull();
  });
});

describe("auth configuration", () => {
  it("reads configured values and treats empty values as unset", () => {
    expect(
      authConfigFromEnv({
        STUDIUM_USERNAME: "learner",
        STUDIUM_PASSWORD_HASH: "hash",
        STUDIUM_SESSION_SECRET: "",
        STUDIUM_API_TOKEN: "token",
        STUDIUM_TRUST_PROXY: "true",
        STUDIUM_BASE_URL: "https://studium.example",
      }),
    ).toEqual({
      username: "learner",
      passwordHash: "hash",
      sessionSecret: null,
      apiToken: "token",
      trustProxy: true,
      baseUrl: "https://studium.example",
    });

    expect(authConfigFromEnv({ STUDIUM_TRUST_PROXY: "yes" }).trustProxy).toBe(false);
  });

  it("allows passwordless mode only on localhost", () => {
    const passwordless: AuthConfig = {
      username: null,
      passwordHash: null,
      sessionSecret: null,
      apiToken: null,
      trustProxy: false,
      baseUrl: null,
    };

    expect(() => assertBindAllowed(passwordless, "127.0.0.1")).not.toThrow();
    expect(() => assertBindAllowed(passwordless, "::1")).not.toThrow();
    expect(() => assertBindAllowed(passwordless, "localhost")).not.toThrow();
    expect(() => assertBindAllowed(passwordless, "0.0.0.0")).toThrow(/password is required/);
  });

  it("requires a session secret of at least 32 characters with a password", () => {
    expect(() => assertBindAllowed(protectedConfig, "0.0.0.0")).not.toThrow();
    expect(() => assertBindAllowed({ ...protectedConfig, sessionSecret: null }, "127.0.0.1")).toThrow(
      /at least 32 characters/,
    );
    expect(() => assertBindAllowed({ ...protectedConfig, sessionSecret: "x".repeat(31) }, "127.0.0.1")).toThrow(
      /at least 32 characters/,
    );
  });
});
