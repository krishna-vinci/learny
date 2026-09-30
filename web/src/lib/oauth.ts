// PKCE + state helpers for the SSO sign-in/link flow (M3a T6 slice b). Modeled on Memos'
// `utils/oauth.ts` state/PKCE handling (MIT) — https://github.com/usememos/memos — adapted
// to our provider shape and `sessionStorage` key.
import type { PublicIdentityProvider } from "@/api/client";

const STORAGE_KEY = "studium.oauth.pending";
const STATE_TTL_MS = 10 * 60_000;

export interface OAuthPendingState {
  state: string;
  codeVerifier: string;
  providerId: number;
  mode: "signin" | "link";
  returnUrl: string;
  createdAt: number;
}

function randomString(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function base64UrlEncode(bytes: ArrayBuffer): string {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function codeChallengeFor(codeVerifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(codeVerifier));
  return base64UrlEncode(digest);
}

/** Only allow same-origin, path-relative return targets (never an open redirect). */
export function safeReturnUrl(raw: string | null | undefined): string {
  // Browsers read `/\host` like `//host`, and control characters can hide a scheme-relative URL.
  if (!raw?.startsWith("/") || raw.startsWith("//")) return "/";
  for (const ch of raw) if (ch === "\\" || ch.charCodeAt(0) < 0x20) return "/";
  return raw;
}

export function callbackRedirectUri(): string {
  return new URL("/auth/callback", window.location.origin).toString();
}

/**
 * Builds the provider's authorize URL, stashes the PKCE verifier + state in
 * `sessionStorage`, and returns the URL to navigate the browser to.
 */
export async function startOAuthFlow(
  provider: Pick<PublicIdentityProvider, "id" | "authUrl" | "clientId" | "scopes">,
  opts: { mode: "signin" | "link"; returnUrl: string },
): Promise<string> {
  const state = randomString(16);
  // 32 random bytes -> 43 base64url chars, within PKCE's 43-128 char requirement.
  const codeVerifier = base64UrlEncode(crypto.getRandomValues(new Uint8Array(32)).buffer);
  const codeChallenge = await codeChallengeFor(codeVerifier);

  const pending: OAuthPendingState = {
    state,
    codeVerifier,
    providerId: provider.id,
    mode: opts.mode,
    returnUrl: opts.returnUrl,
    createdAt: Date.now(),
  };
  sessionStorage.setItem(STORAGE_KEY, JSON.stringify(pending));

  const url = new URL(provider.authUrl);
  url.searchParams.set("client_id", provider.clientId);
  url.searchParams.set("redirect_uri", callbackRedirectUri());
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", provider.scopes.join(" "));
  url.searchParams.set("state", state);
  url.searchParams.set("code_challenge", codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  return url.toString();
}

/** Reads and clears the pending flow, validating `state` and its TTL. Returns null on any
 * mismatch (expired tab, replay, or a state that was never ours) so the callback page can
 * show a generic error rather than trusting an unverified value. */
export function consumePendingOAuthState(receivedState: string): OAuthPendingState | null {
  const raw = sessionStorage.getItem(STORAGE_KEY);
  sessionStorage.removeItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    const pending = JSON.parse(raw) as OAuthPendingState;
    if (pending.state !== receivedState) return null;
    if (Date.now() - pending.createdAt > STATE_TTL_MS) return null;
    return pending;
  } catch {
    return null;
  }
}
