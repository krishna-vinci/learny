import type { NotificationPayload } from "./types.js";

export interface NtfyConfig {
  url: string;
  token?: string;
}

export interface NtfyDeps {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 5_000;

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
  const fetchImpl = deps.fetchImpl ?? fetch;
  const headers: Record<string, string> = {
    Title: notification.title,
    Tags: (notification.tags ?? ["bell"]).join(","),
  };
  if (notification.url !== undefined && notification.url !== "") headers.Click = notification.url;
  if (config.token !== undefined && config.token !== "") headers.Authorization = `Bearer ${config.token}`;

  const response = await fetchImpl(config.url, {
    method: "POST",
    headers,
    body: notification.body,
    signal: AbortSignal.timeout(deps.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`ntfy responded with ${response.status}`);
}
