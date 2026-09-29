import type { DatabaseSync } from "node:sqlite";
import { type Context, Hono } from "hono";
import {
  createIdentityProvider,
  deleteIdentityProvider,
  getIdentityProvider,
  getIdentityUserId,
  type IdentityFieldMapping,
  type IdentityProvider,
  linkIdentity,
  listIdentityProviders,
  listUserIdentities,
  unlinkIdentity,
  updateIdentityProvider,
} from "../accounts/identities.js";
import { getInstanceSettings } from "../accounts/settings.js";
import { getUserByEmail, getUserById } from "../accounts/users.js";
import { type AuthRouteOptions, createSessionForRequest, requestOrigin } from "../auth/routes.js";
import { decryptSecret, encryptSecret } from "../db/crypto.js";
import { exchangeOAuth2Identity, type OAuth2Identity } from "./oauth2.js";

interface SsoOptions {
  db: DatabaseSync;
  secretsKey: Buffer;
  auth: AuthRouteOptions;
}

interface SsoRequest {
  providerId: number;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

interface ProviderInput {
  title: string;
  type: "OAUTH2";
  identifierFilter: string;
  clientId: string;
  clientSecret?: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  fieldMapping: IdentityFieldMapping;
  autoLinkByEmail: boolean;
}

async function jsonBody(c: Context): Promise<Record<string, unknown> | null> {
  try {
    const body: unknown = await c.req.json();
    return typeof body === "object" && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function parsePositiveId(value: unknown): number | null {
  const id = typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : null;
}

function parseSsoRequest(body: Record<string, unknown> | null): SsoRequest | null {
  const providerId = parsePositiveId(body?.providerId);
  if (
    providerId === null ||
    typeof body?.code !== "string" ||
    body.code === "" ||
    typeof body.redirectUri !== "string" ||
    (body.codeVerifier !== undefined && typeof body.codeVerifier !== "string")
  ) {
    return null;
  }
  return {
    providerId,
    code: body.code,
    redirectUri: body.redirectUri,
    ...(typeof body.codeVerifier === "string" ? { codeVerifier: body.codeVerifier } : {}),
  };
}

function expectedRedirectUri(c: Context, options: SsoOptions): string {
  const configured = getInstanceSettings(options.db).instanceUrl;
  const origin = configured === "" ? requestOrigin(c, options.auth) : new URL(configured).origin;
  return new URL("/auth/callback", origin).toString();
}

async function resolveIdentity(
  c: Context,
  options: SsoOptions,
  request: SsoRequest,
): Promise<{ provider: IdentityProvider; identity: OAuth2Identity } | Response> {
  if (request.redirectUri !== expectedRedirectUri(c, options)) {
    return c.json({ error: "redirectUri does not match the configured callback URL" }, 400);
  }
  const provider = getIdentityProvider(options.db, request.providerId);
  if (provider === null) return c.json({ error: "identity provider not found" }, 400);
  let identity: OAuth2Identity;
  try {
    identity = await exchangeOAuth2Identity(
      {
        clientId: provider.config.clientId,
        clientSecret: decryptSecret(options.secretsKey, provider.config.clientSecretEnc),
        tokenUrl: provider.config.tokenUrl,
        userInfoUrl: provider.config.userInfoUrl,
        fieldMapping: provider.config.fieldMapping,
      },
      request,
    );
  } catch {
    return c.json({ error: "identity provider authentication failed" }, 502);
  }
  if (provider.identifierFilter !== "" && !new RegExp(provider.identifierFilter).test(identity.identifier)) {
    return c.json({ error: "identity is not allowed by this provider" }, 403);
  }
  return { provider, identity };
}

function adminView(provider: IdentityProvider) {
  return {
    id: provider.id,
    title: provider.title,
    type: provider.type,
    identifierFilter: provider.identifierFilter,
    clientId: provider.config.clientId,
    authUrl: provider.config.authUrl,
    tokenUrl: provider.config.tokenUrl,
    userInfoUrl: provider.config.userInfoUrl,
    scopes: provider.config.scopes,
    fieldMapping: provider.config.fieldMapping,
    hasClientSecret: provider.config.clientSecretEnc !== "",
    autoLinkByEmail: provider.config.autoLinkByEmail === true,
  };
}

function privateHttpHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host === "::1") return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  return (
    parts[0] === 10 ||
    (parts[0] === 172 && (parts[1] ?? 0) >= 16 && (parts[1] ?? 0) <= 31) ||
    (parts[0] === 192 && parts[1] === 168) ||
    parts[0] === 127
  );
}

function validProviderUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.username !== "" || url.password !== "") return false;
    return url.protocol === "https:" || (url.protocol === "http:" && privateHttpHost(url.hostname));
  } catch {
    return false;
  }
}

function stringValue(body: Record<string, unknown>, key: string, fallback?: string): string | null {
  const value = body[key];
  if (value === undefined && fallback !== undefined) return fallback;
  return typeof value === "string" ? value : null;
}

function parseMapping(value: unknown, fallback?: IdentityFieldMapping): IdentityFieldMapping | null {
  if (value === undefined && fallback !== undefined) return fallback;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const mapping = value as Record<string, unknown>;
  const identifier = mapping.identifier;
  const displayName = mapping.displayName ?? "";
  const email = mapping.email ?? "";
  const avatarUrl = mapping.avatarUrl ?? "";
  return typeof identifier === "string" &&
    typeof displayName === "string" &&
    typeof email === "string" &&
    typeof avatarUrl === "string"
    ? { identifier, displayName, email, avatarUrl }
    : null;
}

function parseProviderInput(
  body: Record<string, unknown>,
  existing?: IdentityProvider,
): { input: ProviderInput } | { error: string } {
  const title = stringValue(body, "title", existing?.title);
  const type = body.type ?? existing?.type ?? "OAUTH2";
  const identifierFilter = stringValue(body, "identifierFilter", existing?.identifierFilter ?? "");
  const clientId = stringValue(body, "clientId", existing?.config.clientId);
  const clientSecret = stringValue(body, "clientSecret");
  const authUrl = stringValue(body, "authUrl", existing?.config.authUrl);
  const tokenUrl = stringValue(body, "tokenUrl", existing?.config.tokenUrl);
  const userInfoUrl = stringValue(body, "userInfoUrl", existing?.config.userInfoUrl);
  const scopesValue = body.scopes === undefined ? existing?.config.scopes : body.scopes;
  const mapping = parseMapping(body.fieldMapping, existing?.config.fieldMapping);
  if (title === null || title.trim() === "") return { error: "title is required" };
  if (type !== "OAUTH2") return { error: "type must be OAUTH2" };
  if (identifierFilter === null) return { error: "identifierFilter must be a string" };
  try {
    if (identifierFilter !== "") new RegExp(identifierFilter);
  } catch {
    return { error: "identifierFilter must be a valid regular expression" };
  }
  if (clientId === null || clientId === "") return { error: "clientId is required" };
  if (existing === undefined && (clientSecret === null || clientSecret === "")) {
    return { error: "clientSecret is required" };
  }
  if (body.clientSecret !== undefined && typeof body.clientSecret !== "string") {
    return { error: "clientSecret must be a string" };
  }
  if (clientSecret !== null && clientSecret === "") return { error: "clientSecret must not be empty" };
  if (authUrl === null || !validProviderUrl(authUrl)) return { error: "authUrl must be a valid provider URL" };
  if (tokenUrl === null || !validProviderUrl(tokenUrl)) return { error: "tokenUrl must be a valid provider URL" };
  if (userInfoUrl === null || !validProviderUrl(userInfoUrl)) {
    return { error: "userInfoUrl must be a valid provider URL" };
  }
  if (!Array.isArray(scopesValue) || scopesValue.some((scope) => typeof scope !== "string")) {
    return { error: "scopes must be an array of strings" };
  }
  if (mapping === null || mapping.identifier === "") return { error: "fieldMapping.identifier is required" };
  const autoLinkByEmail = body.autoLinkByEmail ?? existing?.config.autoLinkByEmail ?? false;
  if (typeof autoLinkByEmail !== "boolean") return { error: "autoLinkByEmail must be a boolean" };
  return {
    input: {
      title,
      type,
      identifierFilter,
      clientId,
      ...(clientSecret === null ? {} : { clientSecret }),
      authUrl,
      tokenUrl,
      userInfoUrl,
      scopes: scopesValue as string[],
      fieldMapping: mapping,
      autoLinkByEmail,
    },
  };
}

export function ssoAuthRoutes(options: SsoOptions): Hono {
  const app = new Hono();
  app.post("/sso", async (c) => {
    const request = parseSsoRequest(await jsonBody(c));
    if (request === null) return c.json({ error: "invalid SSO request" }, 400);
    const resolved = await resolveIdentity(c, options, request);
    if (resolved instanceof Response) return resolved;
    const { provider, identity } = resolved;
    const linkedUserId = getIdentityUserId(options.db, provider.id, identity.identifier);
    let user = linkedUserId === null ? null : getUserById(options.db, linkedUserId);
    // Email matching can take over an account if the provider lets users set unverified
    // emails, so it is opt-in per provider and never links to an admin.
    if (user === null && identity.email !== "" && provider.config.autoLinkByEmail === true) {
      const byEmail = getUserByEmail(options.db, identity.email);
      user = byEmail?.role === "ADMIN" ? null : byEmail;
      if (user !== null) {
        if (user.state === "ARCHIVED") return c.json({ error: "account is archived" }, 403);
        try {
          linkIdentity(options.db, user.id, provider.id, identity.identifier);
        } catch {
          return c.json({ error: "identity provider account could not be linked" }, 409);
        }
      }
    }
    if (user === null) {
      return c.json({ error: "no Studium account is linked to this identity; ask the admin" }, 403);
    }
    if (user.state === "ARCHIVED") return c.json({ error: "account is archived" }, 403);
    createSessionForRequest(c, options.auth, user.id);
    return c.json({ user });
  });
  return app;
}

export function identityRoutes(options: SsoOptions): Hono {
  const app = new Hono();
  app.get("/", (c) => c.json({ identities: listUserIdentities(options.db, c.get("user").id) }));
  app.post("/", async (c) => {
    const request = parseSsoRequest(await jsonBody(c));
    if (request === null) return c.json({ error: "invalid SSO request" }, 400);
    const resolved = await resolveIdentity(c, options, request);
    if (resolved instanceof Response) return resolved;
    try {
      linkIdentity(options.db, c.get("user").id, resolved.provider.id, resolved.identity.identifier);
    } catch (error) {
      return c.json({ error: error instanceof Error ? error.message : "identity could not be linked" }, 409);
    }
    const identity = listUserIdentities(options.db, c.get("user").id).find(
      (item) => item.providerId === resolved.provider.id,
    );
    return c.json({ identity }, 201);
  });
  app.delete("/:providerId", (c) => {
    const providerId = parsePositiveId(c.req.param("providerId"));
    if (providerId === null) return c.json({ error: "invalid provider id" }, 400);
    if (!unlinkIdentity(options.db, c.get("user").id, providerId)) {
      return c.json({ error: "linked identity not found" }, 404);
    }
    return c.body(null, 204);
  });
  return app;
}

export function identityProviderAdminRoutes(options: SsoOptions): Hono {
  const app = new Hono();
  app.get("/", (c) => c.json({ identityProviders: listIdentityProviders(options.db).map(adminView) }));
  app.get("/:id", (c) => {
    const id = parsePositiveId(c.req.param("id"));
    const provider = id === null ? null : getIdentityProvider(options.db, id);
    return provider === null
      ? c.json({ error: "identity provider not found" }, 404)
      : c.json({ identityProvider: adminView(provider) });
  });
  app.post("/", async (c) => {
    const body = await jsonBody(c);
    if (body === null) return c.json({ error: "invalid JSON body" }, 400);
    const parsed = parseProviderInput(body);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);
    const input = parsed.input;
    const provider = createIdentityProvider(options.db, {
      title: input.title,
      type: input.type,
      identifierFilter: input.identifierFilter,
      config: {
        clientId: input.clientId,
        clientSecretEnc: encryptSecret(options.secretsKey, input.clientSecret ?? ""),
        authUrl: input.authUrl,
        tokenUrl: input.tokenUrl,
        userInfoUrl: input.userInfoUrl,
        scopes: input.scopes,
        fieldMapping: input.fieldMapping,
        autoLinkByEmail: input.autoLinkByEmail,
      },
    });
    return c.json({ identityProvider: adminView(provider) }, 201);
  });
  app.patch("/:id", async (c) => {
    const id = parsePositiveId(c.req.param("id"));
    const existing = id === null ? null : getIdentityProvider(options.db, id);
    if (existing === null) return c.json({ error: "identity provider not found" }, 404);
    const body = await jsonBody(c);
    if (body === null) return c.json({ error: "invalid JSON body" }, 400);
    const parsed = parseProviderInput(body, existing);
    if ("error" in parsed) return c.json({ error: parsed.error }, 400);
    const input = parsed.input;
    const provider = updateIdentityProvider(options.db, existing.id, {
      title: input.title,
      type: input.type,
      identifierFilter: input.identifierFilter,
      config: {
        clientId: input.clientId,
        clientSecretEnc:
          input.clientSecret === undefined
            ? existing.config.clientSecretEnc
            : encryptSecret(options.secretsKey, input.clientSecret),
        authUrl: input.authUrl,
        tokenUrl: input.tokenUrl,
        userInfoUrl: input.userInfoUrl,
        scopes: input.scopes,
        fieldMapping: input.fieldMapping,
        autoLinkByEmail: input.autoLinkByEmail,
      },
    });
    return c.json({ identityProvider: adminView(provider as IdentityProvider) });
  });
  app.delete("/:id", (c) => {
    const id = parsePositiveId(c.req.param("id"));
    if (id === null) return c.json({ error: "invalid provider id" }, 400);
    if (!deleteIdentityProvider(options.db, id)) return c.json({ error: "identity provider not found" }, 404);
    return c.body(null, 204);
  });
  return app;
}
