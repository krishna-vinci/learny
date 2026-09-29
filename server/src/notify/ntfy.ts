import { safeFetch } from "../ingest/safe-fetch.js";
import type { NotificationPayload } from "./types.js";

export interface NtfyConfig {
  url: string;
  token?: string;
}

export interface NtfyDeps {
  fetchImpl?: typeof fetch;
  safeFetchImpl?: typeof safeFetch;
  timeoutMs?: number;
  isAdmin?: boolean;
}

const DEFAULT_TIMEOUT_MS = 5_000;
const MAX_RESPONSE_BYTES = 16 * 1024;

export function validNtfyUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && url.username === "" && url.password === "";
  } catch {
    return false;
  }
}

/**
 * Publish a notification to an ntfy topic. Plain POST per the ntfy publish API:
 * the message text is the body, metadata rides in headers.
 */
export async function sendNtfy(
  config: NtfyConfig,
  notification: NotificationPayload,
  deps: NtfyDeps = {},
): Promise<void> {
  const isAdmin = deps.isAdmin === true;
  if (!validNtfyUrl(config.url) || (!isAdmin && new URL(config.url).protocol !== "https:")) {
    throw new Error(isAdmin ? "ntfy URL must be http(s)" : "ntfy URL must be public https");
  }
  const headers: Record<string, string> = {
    Title: notification.title,
    Tags: (notification.tags ?? ["bell"]).join(","),
  };
  if (notification.url !== undefined && notification.url !== "") headers.Click = notification.url;
  if (config.token !== undefined && config.token !== "") headers.Authorization = `Bearer ${config.token}`;

  const response = isAdmin
    ? await (deps.fetchImpl ?? fetch)(config.url, {
        method: "POST",
        headers,
        body: notification.body,
        redirect: "error",
        signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
      })
    : await (deps.safeFetchImpl ?? safeFetch)(config.url, {
        method: "POST",
        headers,
        body: notification.body,
        timeoutMs: deps.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        maxBytes: MAX_RESPONSE_BYTES,
        allowErrorStatus: true,
      });
  if (!response.ok) throw new Error(`ntfy responded with ${response.status}`);
}
