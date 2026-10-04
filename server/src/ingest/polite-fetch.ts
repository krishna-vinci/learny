import { setTimeout as delay } from "node:timers/promises";
import { SafeFetchError, type SafeFetchOptions, safeFetch } from "./safe-fetch.js";

export function retryAfterMs(value: string | null, now = Date.now()): number {
  if (value === null) return 1000;
  const seconds = Number(value);
  const milliseconds = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(value) - now;
  return Number.isFinite(milliseconds) ? Math.max(0, Math.min(10_000, milliseconds)) : 1000;
}

/** One retry only. Every attempt and redirect still goes through safeFetch. */
export async function politeFetch(url: string, options: SafeFetchOptions = {}) {
  let response = await safeFetch(url, { ...options, allowErrorStatus: true });
  if (response.status === 429) {
    await delay(retryAfterMs(response.headers.get("retry-after")), undefined, { signal: options.signal });
    response = await safeFetch(url, { ...options, allowErrorStatus: true });
  }
  if (!response.ok) throw new SafeFetchError("http_error", `HTTP ${response.status} for ${response.url}`);
  return response;
}

export function paywallHint(url: URL): string {
  return /(?:^|\.)(?:doi\.org|tandfonline\.com|wiley\.com|sciencedirect\.com|springer\.com|academia\.edu|rsc\.org)$/.test(
    url.hostname,
  )
    ? "\npaywalled — look for an open-access copy (papers tools) or a textbook/explainer instead"
    : "";
}
