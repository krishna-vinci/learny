import { existsSync } from "node:fs";
import { serveStatic } from "@hono/node-server/serve-static";
import { Hono } from "hono";
import type { ChatService } from "./agent/chat-service.js";
import { chatRoutes } from "./agent/routes.js";
import { authRoutes, requireAuth } from "./auth/routes.js";
import type { AuthConfig } from "./auth/session.js";
import type { EventHub } from "./events.js";
import { requestGuard } from "./http/guard.js";
import { jobsRoutes } from "./jobs/routes.js";
import type { JobRunner } from "./jobs/runner.js";
import { eventsRoutes } from "./routes/events.js";
import { libraryRoutes } from "./routes/library.js";
import { setsRoutes } from "./routes/sets.js";
import { type SettingsRouteDeps, settingsRoutes } from "./routes/settings.js";
import type { FileLocks } from "./tree/lock.js";

export interface AppDeps {
  root: string;
  hub: EventHub;
  locks: FileLocks;
  auth: AuthConfig;
  chats: ChatService;
  jobs?: JobRunner;
  settings?: SettingsRouteDeps;
  webDist?: string;
}

type LegacyAppDeps = Omit<AppDeps, "chats">;

export function createApp(deps: AppDeps): Hono;
export function createApp(deps: LegacyAppDeps): Hono;
export function createApp(deps: AppDeps | LegacyAppDeps): Hono {
  const app = new Hono();

  app.use("/api/*", requestGuard(deps.auth));
  app.route("/api/auth", authRoutes(deps.auth));

  // Registered after authRoutes so the public login route is handled first.
  app.use("/api/*", requireAuth(deps.auth));

  app.route("/api/sets", setsRoutes({ root: deps.root, hub: deps.hub }));
  app.route("/api/events", eventsRoutes(deps.hub));

  if (deps.jobs !== undefined) {
    app.route("/api/jobs", jobsRoutes({ runner: deps.jobs }));
    app.route("/api/library", libraryRoutes({ root: deps.root, jobs: deps.jobs }));
  }

  if (deps.settings !== undefined) {
    app.route("/api/settings", settingsRoutes({ root: deps.root, locks: deps.locks, ...deps.settings }));
  }

  if ("chats" in deps) {
    app.route("/api/sets/:set/chats", chatRoutes(deps.chats));
  }

  if (deps.webDist !== undefined && existsSync(deps.webDist)) {
    const webRoot = deps.webDist;

    app.use("*", async (c, next) => {
      if (c.req.method !== "GET" || c.req.path.startsWith("/api/")) return next();
      return serveStatic({ root: webRoot })(c, next);
    });

    // SPA fallback: unknown non-API GETs render the shell so client routing works.
    app.get("*", async (c, next) => {
      if (c.req.path.startsWith("/api/")) return next();
      return serveStatic({ root: webRoot, rewriteRequestPath: () => "/index.html" })(c, next);
    });
  }

  return app;
}
