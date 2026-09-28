import type { StudiumEvent } from "@studium/shared";
import { useEffect, useRef } from "react";

const RECONNECT_DELAY_MS = 2000;

/**
 * Subscribes to GET /api/events (SSE) for the lifetime of the component and calls
 * `handler` with each parsed StudiumEvent. Reconnects automatically on error/close.
 */
export function useStudiumEvents(handler: (event: StudiumEvent) => void) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    let source: EventSource | null = null;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const connect = () => {
      if (disposed) return;
      source = new EventSource("/api/events");
      source.addEventListener("studium", (rawEvent) => {
        const messageEvent = rawEvent as MessageEvent<string>;
        try {
          const parsed = JSON.parse(messageEvent.data) as StudiumEvent;
          handlerRef.current(parsed);
        } catch {
          // Ignore malformed events.
        }
      });
      source.onerror = () => {
        source?.close();
        source = null;
        if (disposed) return;
        reconnectTimer = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();

    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      source?.close();
    };
  }, []);
}
