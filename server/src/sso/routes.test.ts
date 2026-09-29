import type { DatabaseSync } from "node:sqlite";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createIdentityProvider,
  getIdentityProvider,
  getIdentityUserId,
  linkIdentity,
} from "../accounts/identities.js";
import { createSession } from "../accounts/sessions.js";
import { createUser, listUsers, updateUser } from "../accounts/users.js";
import { decryptSecret, encryptSecret } from "../db/crypto.js";
import { migrate, openDb } from "../db/db.js";
import { deriveKey } from "../db/secret.js";
import { createServer } from "../server.js";

let db: DatabaseSync;
let app: Hono;
const instanceSecret = Buffer.alloc(32, 7);
const secretsKey = deriveKey(instanceSecret, "studium-secrets-v1");

beforeEach(() => {
  db = openDb(":memory:");
  migrate(db);
  app = createServer({
    db,
    instanceSecret,
    workspaces: {
      for: async () => ({ app: new Hono() }),
      provision: async () => undefined,
      stop: async () => undefined,
      rootFor: () => null,
    },
    authOpts: { trustProxy: false, baseUrl: null, setupCode: null },
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  db.close();
});

function cookie(token: string): Record<string, string> {
  return { cookie: `studium_session=${token}` };
}

function providerBody(overrides: Record<string, unknown> = {}) {
  return {
    title: "Example SSO",
    type: "OAUTH2",
    identifierFilter: "^allowed-",
    clientId: "client-id",
    clientSecret: "super-secret",
    authUrl: "https://idp.example/auth",
    tokenUrl: "https://idp.example/token",
    userInfoUrl: "https://idp.example/userinfo",
    scopes: ["openid", "email"],
    fieldMapping: { identifier: "sub", displayName: "name", email: "email", avatarUrl: "avatar" },
    ...overrides,
  };
}

function insertProvider(identifierFilter = "^allowed-", autoLinkByEmail = false) {
  return createIdentityProvider(db, {
    title: "Example SSO",
    type: "OAUTH2",
    identifierFilter,
    config: {
      clientId: "client-id",
      clientSecretEnc: encryptSecret(secretsKey, "super-secret"),
      authUrl: "https://idp.example/auth",
      tokenUrl: "https://idp.example/token",
      userInfoUrl: "https://idp.example/userinfo",
      scopes: ["openid", "email"],
      fieldMapping: { identifier: "sub", displayName: "name", email: "email", avatarUrl: "avatar" },
      autoLinkByEmail,
    },
  });
}

function stubIdentityProvider(claimsByCode: Record<string, Record<string, unknown>>) {
  const codes: string[] = [];
  const codeVerifiers: Array<string | null> = [];
  const fetchMock = vi.fn<typeof fetch>(async (input, init) => {
    const url = String(input);
    if (url.endsWith("/token")) {
      const form = new URLSearchParams(String(init?.body));
      const code = form.get("code") ?? "";
      codes.push(code);
      codeVerifiers.push(form.get("code_verifier"));
      return new Response(JSON.stringify({ access_token: `token-${code}` }), {
        headers: { "content-type": "application/json" },
      });
    }
    const headers = new Headers(init?.headers);
    const code = (headers.get("authorization") ?? "").replace("Bearer token-", "");
    return new Response(JSON.stringify(claimsByCode[code] ?? {}), {
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, codes, codeVerifiers };
}

async function sso(providerId: number, code: string, extra: Record<string, unknown> = {}) {
  return app.request("/api/auth/sso", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      providerId,
      code,
      redirectUri: "http://localhost/auth/callback",
      ...extra,
    }),
  });
}

describe("SSO routes", () => {
  it("keeps client secrets write-only across admin CRUD and exposes only public authorization fields", async () => {
    const admin = await createUser(db, { username: "admin-user", password: "admin-pass", role: "ADMIN" });
    const session = createSession(db, admin.id, { userAgent: "test", ip: "127.0.0.1" });
    const created = await app.request("/api/admin/identity-providers", {
      method: "POST",
      headers: { ...cookie(session.token), "content-type": "application/json" },
      body: JSON.stringify(providerBody()),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { identityProvider: Record<string, unknown> };
    expect(createdBody.identityProvider).toMatchObject({ title: "Example SSO", hasClientSecret: true });
    expect(createdBody.identityProvider.clientSecret).toBeUndefined();
    expect(JSON.stringify(createdBody)).not.toContain("super-secret");
    const providerId = createdBody.identityProvider.id as number;
    expect(decryptSecret(secretsKey, getIdentityProvider(db, providerId)?.config.clientSecretEnc ?? "")).toBe(
      "super-secret",
    );

    const patched = await app.request(`/api/admin/identity-providers/${providerId}`, {
      method: "PATCH",
      headers: { ...cookie(session.token), "content-type": "application/json" },
      body: JSON.stringify({ title: "Renamed SSO" }),
    });
    expect(patched.status).toBe(200);
    expect(decryptSecret(secretsKey, getIdentityProvider(db, providerId)?.config.clientSecretEnc ?? "")).toBe(
      "super-secret",
    );
    const fetched = (await (
      await app.request(`/api/admin/identity-providers/${providerId}`, { headers: cookie(session.token) })
    ).json()) as { identityProvider: Record<string, unknown> };
    expect(fetched.identityProvider.clientSecret).toBeUndefined();
    expect(JSON.stringify(fetched)).not.toContain("super-secret");

    const status = (await (await app.request("/api/auth/status")).json()) as Record<string, unknown>;
    expect(status.identityProviders).toEqual([
      {
        id: providerId,
        title: "Renamed SSO",
        authUrl: "https://idp.example/auth",
        clientId: "client-id",
        scopes: ["openid", "email"],
      },
    ]);
    expect(JSON.stringify(status)).not.toContain("tokenUrl");
    expect(JSON.stringify(status)).not.toContain("userInfoUrl");
    expect(
      (
        await app.request(`/api/admin/identity-providers/${providerId}`, {
          method: "DELETE",
          headers: cookie(session.token),
        })
      ).status,
    ).toBe(204);
  });

  it("rejects long or nested-quantifier identifier filters", async () => {
    const admin = await createUser(db, { username: "admin-user", role: "ADMIN" });
    const session = createSession(db, admin.id, { userAgent: "", ip: "" });
    const create = (identifierFilter: string) =>
      app.request("/api/admin/identity-providers", {
        method: "POST",
        headers: { ...cookie(session.token), "content-type": "application/json" },
        body: JSON.stringify(providerBody({ identifierFilter })),
      });
    expect((await create("(a+)+")).status).toBe(400);
    expect((await create("(a|a)+")).status).toBe(400);
    expect((await create("a".repeat(201))).status).toBe(400);
  });

  it("signs in a linked user or unique email match, never creates an account, and forwards PKCE", async () => {
    const provider = insertProvider("^allowed-", true);
    const linked = await createUser(db, { username: "linked-user", role: "USER" });
    const emailUser = await createUser(db, { username: "email-user", email: "email@example.com", role: "USER" });
    linkIdentity(db, linked.id, provider.id, "allowed-linked");
    const initialUsers = listUsers(db).length;
    const fake = stubIdentityProvider({
      linked: { sub: "allowed-linked" },
      email: { sub: "allowed-email", email: "EMAIL@example.com" },
      missing: { sub: "allowed-missing", email: "missing@example.com" },
    });

    const linkedResponse = await sso(provider.id, "linked", { codeVerifier: "pkce-verifier" });
    expect(linkedResponse.status).toBe(200);
    expect(linkedResponse.headers.get("set-cookie")).toContain("studium_session=");
    expect(fake.codeVerifiers).toEqual(["pkce-verifier"]);

    const emailResponse = await sso(provider.id, "email");
    expect(emailResponse.status).toBe(200);
    expect(getIdentityUserId(db, provider.id, "allowed-email")).toBe(emailUser.id);

    const missingResponse = await sso(provider.id, "missing");
    expect(missingResponse.status).toBe(403);
    await expect(missingResponse.json()).resolves.toEqual({
      error: "no Studium account is linked to this identity; ask the admin",
    });
    expect(listUsers(db)).toHaveLength(initialUsers);
  });

  it("links by email only when the provider opts in, and never to an admin", async () => {
    const optedOut = insertProvider();
    const optedIn = insertProvider("^allowed-", true);
    await createUser(db, { username: "plain-user", email: "plain@example.com", role: "USER" });
    await createUser(db, { username: "boss", email: "boss@example.com", role: "ADMIN" });
    stubIdentityProvider({
      plain: { sub: "allowed-plain", email: "plain@example.com" },
      boss: { sub: "allowed-boss", email: "boss@example.com" },
    });
    expect((await sso(optedOut.id, "plain")).status).toBe(403);
    expect((await sso(optedIn.id, "boss")).status).toBe(403);
    expect((await sso(optedIn.id, "plain")).status).toBe(200);
  });

  it("rejects a redirect mismatch, filtered identifier, and archived account", async () => {
    const provider = insertProvider();
    const archived = await createUser(db, { username: "archived-user", role: "USER" });
    linkIdentity(db, archived.id, provider.id, "allowed-archived");
    updateUser(db, archived.id, { state: "ARCHIVED" });
    const fake = stubIdentityProvider({
      blocked: { sub: "blocked" },
      archived: { sub: "allowed-archived" },
    });
    const mismatch = await sso(provider.id, "blocked", { redirectUri: "https://evil.example/auth/callback" });
    expect(mismatch.status).toBe(400);
    expect(fake.fetchMock).not.toHaveBeenCalled();
    expect((await sso(provider.id, "blocked")).status).toBe(403);
    expect((await sso(provider.id, "archived")).status).toBe(403);
  });

  it("rejects identifiers longer than 256 characters before applying a filter", async () => {
    const provider = insertProvider("");
    stubIdentityProvider({ long: { sub: "a".repeat(300) } });
    const response = await sso(provider.id, "long");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({ error: "identity is not allowed by this provider" });
  });

  it("refuses email auto-linking when more than one account matches case-insensitively", async () => {
    const provider = insertProvider("^allowed-", true);
    await createUser(db, { username: "duplicate-one", email: "same@example.com", role: "USER" });
    await createUser(db, { username: "duplicate-two", email: "SAME@example.com", role: "USER" });
    stubIdentityProvider({ duplicate: { sub: "allowed-duplicate", email: "Same@example.com" } });
    const response = await sso(provider.id, "duplicate");
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "no Studium account is linked to this identity; ask the admin",
    });
    expect(getIdentityUserId(db, provider.id, "allowed-duplicate")).toBeNull();
  });

  it("links and unlinks an identity for the current user and rejects another user's identity", async () => {
    const provider = insertProvider();
    const user = await createUser(db, { username: "current-user", role: "USER" });
    const other = await createUser(db, { username: "other-user", role: "USER" });
    linkIdentity(db, other.id, provider.id, "allowed-taken");
    const session = createSession(db, user.id, { userAgent: "test", ip: "127.0.0.1" });
    stubIdentityProvider({ mine: { sub: "allowed-mine" }, taken: { sub: "allowed-taken" } });
    const request = (code: string) =>
      app.request("/api/me/identities", {
        method: "POST",
        headers: { ...cookie(session.token), "content-type": "application/json" },
        body: JSON.stringify({ providerId: provider.id, code, redirectUri: "http://localhost/auth/callback" }),
      });

    expect((await request("taken")).status).toBe(409);
    expect((await request("mine")).status).toBe(201);
    const listed = await app.request("/api/me/identities", { headers: cookie(session.token) });
    await expect(listed.json()).resolves.toMatchObject({
      identities: [{ providerId: provider.id, subject: "allowed-mine" }],
    });
    expect(
      (
        await app.request(`/api/me/identities/${provider.id}`, {
          method: "DELETE",
          headers: cookie(session.token),
        })
      ).status,
    ).toBe(204);
    expect(getIdentityUserId(db, provider.id, "allowed-mine")).toBeNull();
  });

  it("allows HTTP provider URLs only for localhost or RFC1918 hosts", async () => {
    const admin = await createUser(db, { username: "admin-user", role: "ADMIN" });
    const session = createSession(db, admin.id, { userAgent: "", ip: "" });
    const create = (tokenUrl: string) =>
      app.request("/api/admin/identity-providers", {
        method: "POST",
        headers: { ...cookie(session.token), "content-type": "application/json" },
        body: JSON.stringify(
          providerBody({
            authUrl: "http://localhost/auth",
            tokenUrl,
            userInfoUrl: "http://192.168.1.5/userinfo",
          }),
        ),
      });
    expect((await create("http://10.0.0.4/token")).status).toBe(201);
    expect((await create("http://idp.example/token")).status).toBe(400);
  });
});
