import type { StudiumEvent } from "@studium/shared";
import { useEffect, useRef } from "react";

const RECONNECT_DELAY_MS = 2000;

type Listener = (event: StudiumEvent) => void;

// One EventSource for the whole app. Browsers allow only ~6 HTTP/1.1 connections per origin and an
// SSE stream holds one open forever, so a connection per subscriber starves every other request.
const listeners = new Set<Listener>();
let source: EventSource | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

function connect(): void {
  if (source !== null || listeners.size === 0) return;
  source = new EventSource("/api/events");
  source.addEventListener("studium", (rawEvent) => {
    let parsed: StudiumEvent;
    try {
      parsed = JSON.parse((rawEvent as MessageEvent<string>).data) as StudiumEvent;
    } catch {
      return; // Ignore malformed events.
    }
    for (const listener of listeners) listener(parsed);
  });
  source.onerror = () => {
    source?.close();
    source = null;
    if (listeners.size > 0 && reconnectTimer === null) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, RECONNECT_DELAY_MS);
    }
  };
}

function disconnectIfIdle(): void {
  if (listeners.size > 0) return;
  if (reconnectTimer !== null) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  source?.close();
  source = null;
}

/** Subscribes `listener` to the shared stream; returns the unsubscribe function. */
export function subscribeStudiumEvents(listener: Listener): () => void {
  listeners.add(listener);
  connect();
  return () => {
    listeners.delete(listener);
    disconnectIfIdle();
  };
}

/**
 * Calls `handler` with each StudiumEvent from GET /api/events (SSE) for the lifetime of the
 * component. All components share one connection, which reconnects automatically.
 */
export function useStudiumEvents(handler: (event: StudiumEvent) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => subscribeStudiumEvents((event) => handlerRef.current(event)), []);
}
