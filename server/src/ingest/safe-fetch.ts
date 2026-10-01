import { promises as dns } from "node:dns";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Agent } from "undici";

export type SafeFetchErrorCode =
  | "invalid_url"
  | "unsupported_protocol"
  | "blocked_host"
  | "blocked_address"
  | "dns_error"
  | "too_large"
  | "too_many_redirects"
  | "timeout"
  | "network_error"
  | "http_error";

export class SafeFetchError extends Error {
  readonly code: SafeFetchErrorCode;

  constructor(code: SafeFetchErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SafeFetchError";
    this.code = code;
  }
}

export const SAFE_FETCH_TIMEOUT_MS = 15_000;
export const SAFE_FETCH_MAX_BYTES = 5 * 1024 * 1024;
/** Larger cap for ingest downloads such as arXiv PDFs. */
export const INGEST_MAX_BYTES = 40 * 1024 * 1024;

const MAX_REDIRECTS = 5;

// Addresses that must never be reached by an agent- or user-supplied URL:
// loopback, private, link-local, carrier-grade NAT, multicast and reserved ranges.
const blockedAddresses = new BlockList();
for (const cidr of [
  "0.0.0.0/8",
  "10.0.0.0/8",
  "100.64.0.0/10",
  "127.0.0.0/8",
  "169.254.0.0/16",
  "172.16.0.0/12",
  "192.0.0.0/24",
  "192.0.2.0/24",
  "192.88.99.0/24",
  "192.168.0.0/16",
  "198.18.0.0/15",
  "198.51.100.0/24",
  "203.0.113.0/24",
  "224.0.0.0/4",
  "240.0.0.0/4",
]) {
  const [base, prefix] = cidr.split("/");
  blockedAddresses.addSubnet(base as string, Number(prefix), "ipv4");
}
blockedAddresses.addAddress("255.255.255.255", "ipv4");
blockedAddresses.addAddress("::", "ipv6");
blockedAddresses.addAddress("::1", "ipv6");
blockedAddresses.addSubnet("fc00::", 7, "ipv6");
blockedAddresses.addSubnet("fe80::", 10, "ipv6");
blockedAddresses.addSubnet("ff00::", 8, "ipv6");
blockedAddresses.addSubnet("64:ff9b::", 96, "ipv6");
blockedAddresses.addSubnet("2001:db8::", 32, "ipv6");

/** True for hostnames we refuse to resolve: localhost and `.local` mDNS names. */
export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (host === "") return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host === "local" || host.endsWith(".local")) return true;
  return false;
}

/** True for address literals in loopback/private/link-local/reserved ranges. */
export function isBlockedAddress(address: string, family?: number): boolean {
  const resolvedFamily = family ?? (isIP(address) === 6 ? 6 : 4);
  if (resolvedFamily === 6) {
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
    if (mapped?.[1] !== undefined) return isBlockedAddress(mapped[1], 4);
    return blockedAddresses.check(address, "ipv6");
  }
  return blockedAddresses.check(address, "ipv4");
}

/**
 * Validate a URL for outbound fetching: http(s) only, hostname not `*.local`,
 * and every address it resolves to must be public.
 *
 * Returns the parsed URL so callers can reuse the normalization.
 */
export async function assertPublicUrl(rawUrl: string): Promise<URL> {
  return (await resolvePublicUrl(rawUrl)).url;
}

interface ResolvedPublicUrl {
  url: URL;
  address: string;
  family: 4 | 6;
}

async function resolvePublicUrl(rawUrl: string): Promise<ResolvedPublicUrl> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch (cause) {
    throw new SafeFetchError("invalid_url", `Not a valid URL: ${rawUrl}`, { cause });
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new SafeFetchError("unsupported_protocol", `Only http and https URLs are allowed: ${url.protocol}`);
  }
  if (url.username !== "" || url.password !== "") {
    throw new SafeFetchError("invalid_url", "URLs with embedded credentials are not allowed");
  }
  const host = url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  if (host === "") throw new SafeFetchError("invalid_url", `URL has no host: ${rawUrl}`);
  if (isBlockedHostname(host)) {
    throw new SafeFetchError("blocked_host", `Refusing to fetch local host: ${host}`);
  }
  if (isIP(host) !== 0) {
    if (isBlockedAddress(host)) {
      throw new SafeFetchError("blocked_address", `Refusing to fetch private address: ${host}`);
    }
    return { url, address: host, family: isIP(host) as 4 | 6 };
  }

  let records: { address: string; family: number }[];
  try {
    records = await dns.lookup(host, { all: true, verbatim: true });
  } catch (cause) {
    throw new SafeFetchError("dns_error", `Cannot resolve host: ${host}`, { cause });
  }
  if (records.length === 0) throw new SafeFetchError("dns_error", `Cannot resolve host: ${host}`);
  for (const record of records) {
    if (isBlockedAddress(record.address, record.family)) {
      throw new SafeFetchError("blocked_address", `Refusing to fetch ${host} (resolves to ${record.address})`);
    }
  }
  const selected = records[0] as { address: string; family: number };
  return { url, address: selected.address, family: selected.family === 6 ? 6 : 4 };
}

export interface SafeFetchOptions {
  /** Refuse protocol downgrades on every redirect hop. */
  httpsOnly?: boolean;
  method?: string;
  headers?: Record<string, string>;
  body?: RequestInit["body"];
  signal?: AbortSignal;
  timeoutMs?: number;
  maxBytes?: number;
  /** Accept responses with a non-2xx status instead of throwing. Defaults to false. */
  allowErrorStatus?: boolean;
}

export interface SafeFetchResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: Headers;
  contentType: string | null;
  bytes: Uint8Array;
}

/**
 * Fetch a URL with SSRF protection: http(s) only, public addresses only,
 * manual redirect handling (each hop re-validated), a total timeout and a
 * byte cap. Throws {@link SafeFetchError} on any violation.
 */
export async function safeFetch(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  const timeoutMs = options.timeoutMs ?? SAFE_FETCH_TIMEOUT_MS;
  const maxBytes = options.maxBytes ?? SAFE_FETCH_MAX_BYTES;
  let currentUrl = rawUrl;
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(new Error("timeout")), timeoutMs);
  const signal = options.signal ? AbortSignal.any([deadline.signal, options.signal]) : deadline.signal;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      if (deadline.signal.aborted) {
        throw new SafeFetchError("timeout", `Request timed out after ${timeoutMs}ms: ${currentUrl}`);
      }
      const resolved = await resolvePublicUrl(currentUrl);
      if (options.httpsOnly && resolved.url.protocol !== "https:")
        throw new SafeFetchError("unsupported_protocol", "Only HTTPS image URLs are allowed, including redirects");
      const dispatcher = pinnedDispatcher(resolved);
      let response: Response;
      try {
        try {
          response = await fetch(resolved.url, {
            method: options.method ?? "GET",
            headers: options.headers,
            body: options.body,
            redirect: "manual",
            signal,
            dispatcher,
          } as RequestInit & { dispatcher: Agent });
        } catch (cause) {
          if (deadline.signal.aborted) {
            throw new SafeFetchError("timeout", `Request timed out after ${timeoutMs}ms: ${resolved.url.href}`, {
              cause,
            });
          }
          throw new SafeFetchError("network_error", `Request failed: ${resolved.url.href}`, { cause });
        }

        if (isRedirect(response.status)) {
          await response.body?.cancel().catch(() => undefined);
          const location = response.headers.get("location");
          if (location === null || location === "") {
            throw new SafeFetchError("network_error", `Redirect without Location from ${resolved.url.href}`);
          }
          if (hop === MAX_REDIRECTS) {
            throw new SafeFetchError("too_many_redirects", `Too many redirects for ${rawUrl}`);
          }
          currentUrl = new URL(location, resolved.url).href;
          continue;
        }

        const bytes = await readCappedResponse(response, maxBytes, resolved.url.href);
        if (!response.ok && options.allowErrorStatus !== true) {
          throw new SafeFetchError("http_error", `HTTP ${response.status} for ${resolved.url.href}`);
        }
        return {
          url: resolved.url.href,
          status: response.status,
          ok: response.ok,
          headers: response.headers,
          contentType: response.headers.get("content-type"),
          bytes,
        };
      } catch (cause) {
        if (deadline.signal.aborted && !(cause instanceof SafeFetchError && cause.code === "timeout")) {
          throw new SafeFetchError("timeout", `Request timed out after ${timeoutMs}ms: ${resolved.url.href}`, {
            cause,
          });
        }
        throw cause;
      } finally {
        await dispatcher.close().catch(() => undefined);
      }
    }

    throw new SafeFetchError("too_many_redirects", `Too many redirects for ${rawUrl}`);
  } finally {
    clearTimeout(timer);
  }
}

function pinnedDispatcher(resolved: ResolvedPublicUrl): Agent {
  const lookup: LookupFunction = (_hostname, options, callback) => {
    if (options.all === true) {
      callback(null, [{ address: resolved.address, family: resolved.family }]);
      return;
    }
    callback(null, resolved.address, resolved.family);
  };
  const hostname = resolved.url.hostname.replace(/^\[/, "").replace(/\]$/, "");
  return new Agent({
    connect: {
      lookup,
      ...(resolved.url.protocol === "https:" ? { servername: hostname } : {}),
    },
  });
}

function isRedirect(status: number): boolean {
  return status === 301 || status === 302 || status === 303 || status === 307 || status === 308;
}

/** Read a fetch response without allowing either declared or streamed bytes past the cap. */
export async function readCappedResponse(response: Response, maxBytes: number, url: string): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new SafeFetchError("too_large", `Response exceeds ${maxBytes} bytes: ${url}`);
  }
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      throw new SafeFetchError("too_large", `Response exceeds ${maxBytes} bytes: ${url}`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** Decode bytes using the charset from a Content-Type header, defaulting to UTF-8. */
export function decodeBody(bytes: Uint8Array, contentType: string | null): string {
  const charset = /charset=["']?([\w-]+)/i.exec(contentType ?? "")?.[1];
  try {
    return new TextDecoder(charset ?? "utf-8").decode(bytes);
  } catch {
    return new TextDecoder("utf-8").decode(bytes);
  }
}
