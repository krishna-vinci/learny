// Offline reading (docs/UX.md section 6). The service worker (vite.config.ts) caches the last-opened
// sets' notes, source summaries and highlights in `OFFLINE_CACHE`; this module holds the pieces the
// page needs: the online flag, an error for blocked writes, and cache clearing on sign-in/out.
import { useSyncExternalStore } from "react";

/** Must match `cacheName` in vite.config.ts. Cleared whenever the signed-in person can change. */
export const OFFLINE_CACHE = "studium-offline-api";

export class OfflineError extends Error {
  constructor() {
    super("You're offline. Reconnect to save changes.");
    this.name = "OfflineError";
  }
}

const subscribe = (listener: () => void) => {
  window.addEventListener("online", listener);
  window.addEventListener("offline", listener);
  return () => {
    window.removeEventListener("online", listener);
    window.removeEventListener("offline", listener);
  };
};

export function isOffline(): boolean {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/** True while the browser reports no connection. */
export function useOffline(): boolean {
  return useSyncExternalStore(subscribe, isOffline, () => false);
}

/**
 * Drop every offline-cached API response. Called on sign-in, sign-out and an expired session so the
 * next person on this browser can never be served the previous person's notes.
 */
export async function clearOfflineCaches(): Promise<void> {
  if (typeof caches === "undefined") return;
  try {
    await caches.delete(OFFLINE_CACHE);
  } catch {
    // Storage blocked: nothing was cached either.
  }
}
