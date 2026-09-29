import type { IdentityFieldMapping } from "../accounts/identities.js";

const RESPONSE_LIMIT_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 10_000;

export interface OAuth2Config {
  clientId: string;
  clientSecret: string;
  tokenUrl: string;
  userInfoUrl: string;
  fieldMapping: IdentityFieldMapping;
}

export interface OAuth2ExchangeInput {
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface OAuth2Identity {
  identifier: string;
  displayName: string;
  email: string;
  avatarUrl: string;
}

async function readLimited(response: Response): Promise<string> {
  const contentLength = response.headers.get("content-length");
  if (contentLength !== null && Number(contentLength) > RESPONSE_LIMIT_BYTES) {
    await response.body?.cancel();
    throw new Error("identity provider response exceeds 1 MB");
  }
  if (response.body === null) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > RESPONSE_LIMIT_BYTES) {
        await reader.cancel();
        throw new Error("identity provider response exceeds 1 MB");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function parseAccessToken(body: string, contentType: string): string {
  let value: unknown;
  if (contentType.toLowerCase().includes("json") || body.trimStart().startsWith("{")) {
    try {
      value = (JSON.parse(body) as Record<string, unknown>).access_token;
    } catch {
      throw new Error("identity provider returned an invalid token response");
    }
  } else {
    value = new URLSearchParams(body).get("access_token");
  }
  if (typeof value !== "string" || value === "") {
    throw new Error("identity provider token response is missing access_token");
  }
  return value;
}

function dottedString(value: Record<string, unknown>, path: string): string {
  if (path === "") return "";
  let current: unknown = value;
  for (const segment of path.split(".")) {
    if (typeof current !== "object" || current === null || Array.isArray(current)) return "";
    current = (current as Record<string, unknown>)[segment];
  }
  return typeof current === "string" ? current : "";
}

export function mapUserInfo(claims: Record<string, unknown>, mapping: IdentityFieldMapping): OAuth2Identity {
  const identifier = dottedString(claims, mapping.identifier);
  if (identifier === "") throw new Error(`identity provider response is missing ${mapping.identifier}`);
  return {
    identifier,
    displayName: dottedString(claims, mapping.displayName) || identifier,
    email: dottedString(claims, mapping.email),
    avatarUrl: dottedString(claims, mapping.avatarUrl),
  };
}

export async function exchangeOAuth2Identity(
  config: OAuth2Config,
  input: OAuth2ExchangeInput,
  fetchImpl: typeof fetch = fetch,
): Promise<OAuth2Identity> {
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });
  if (input.codeVerifier !== undefined && input.codeVerifier !== "") form.set("code_verifier", input.codeVerifier);

  const tokenResponse = await fetchImpl(config.tokenUrl, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/x-www-form-urlencoded" },
    body: form,
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const tokenBody = await readLimited(tokenResponse);
  if (!tokenResponse.ok) throw new Error(`identity provider token exchange failed (${tokenResponse.status})`);
  const accessToken = parseAccessToken(tokenBody, tokenResponse.headers.get("content-type") ?? "");

  const userInfoResponse = await fetchImpl(config.userInfoUrl, {
    method: "GET",
    headers: { accept: "application/json", authorization: `Bearer ${accessToken}` },
    redirect: "error",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  const userInfoBody = await readLimited(userInfoResponse);
  if (!userInfoResponse.ok) throw new Error(`identity provider userinfo request failed (${userInfoResponse.status})`);
  let claims: unknown;
  try {
    claims = JSON.parse(userInfoBody);
  } catch {
    throw new Error("identity provider returned invalid user information");
  }
  if (typeof claims !== "object" || claims === null || Array.isArray(claims)) {
    throw new Error("identity provider returned invalid user information");
  }
  return mapUserInfo(claims as Record<string, unknown>, config.fieldMapping);
}
