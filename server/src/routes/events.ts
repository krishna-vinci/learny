import type { StudiumEvent } from "@studium/shared";
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import type { EventHub } from "../events.js";

const HEARTBEAT_MS = 25_000;

export function eventsRoutes(hub: EventHub): Hono {
  const app = new Hono();

  app.get("/", (c) =>
    streamSSE(c, async (stream) => {
      const queue: StudiumEvent[] = [];
      let wake: (() => void) | null = null;
      let aborted = false;

      const unsubscribe = hub.subscribe((event) => {
        queue.push(event);
        wake?.();
      });

      const heartbeat = setInterval(() => {
        void stream.write(": keep-alive\n\n");
      }, HEARTBEAT_MS);

      stream.onAbort(() => {
        aborted = true;
        wake?.();
      });

      try {
        while (!aborted) {
          if (queue.length === 0) {
            await new Promise<void>((resolve) => {
              wake = resolve;
            });
            wake = null;
            continue;
          }

          const event = queue.shift();
          if (event === undefined) continue;
          await stream.writeSSE({ event: "studium", data: JSON.stringify(event) });
        }
      } finally {
        clearInterval(heartbeat);
        unsubscribe();
      }
    }),
  );

  return app;
}
