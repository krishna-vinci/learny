/** Read-only localhost API for the M14 real-tree browser screenshots. */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { createApp } from "../src/app.js";
import { EventHub } from "../src/events.js";
import { FileLocks } from "../src/tree/lock.js";

const root = process.argv[2];
if (!root || !/^\/tmp\/studium-m14(?:b)?-/.test(root)) throw new Error("Pass an M14 temporary tree");
const app = new Hono();
app.get("/api/auth/status", (c) => c.json({ setupRequired: false, identityProviders: [] }));
app.get("/api/me", (c) =>
  c.json({
    user: { id: 1, username: "tester", displayName: "M14 trial", role: "ADMIN", aiEnabled: true, avatarUrl: "" },
  }),
);
app.use("*", async (c, next) => {
  if (c.req.method !== "GET") return c.text("Read-only trial", 405);
  return next();
});
app.route("/", createApp({ root, hub: new EventHub(), locks: new FileLocks() }));
const server = serve({ fetch: app.fetch, hostname: "127.0.0.1", port: 0 }, (info) =>
  console.log(`BROWSER_API_PORT=${info.port}`),
);
process.once("SIGTERM", () => {
  server.close();
  server.closeAllConnections();
});
