import { Hono } from "hono";
import type { ChatService } from "./agent/chat-service.js";
import { chatRoutes } from "./agent/routes.js";
import type { EventHub } from "./events.js";
import { jobsRoutes } from "./jobs/routes.js";
import type { JobRunner } from "./jobs/runner.js";
import { ankiRoutes } from "./routes/anki.js";
import { bookRoutes } from "./routes/book.js";
import { cardsRoutes } from "./routes/cards.js";
import { eventsRoutes } from "./routes/events.js";
import { exportRoutes } from "./routes/export.js";
import { highlightsRoutes } from "./routes/highlights.js";
import { inboxRoutes } from "./routes/inbox.js";
import { libraryRoutes } from "./routes/library.js";
import { searchRoutes } from "./routes/search.js";
import { setsRoutes } from "./routes/sets.js";
import { type SettingsRouteDeps, settingsRoutes } from "./routes/settings.js";
import { todayRoutes } from "./routes/today.js";
import type { SearchIndex } from "./search/index.js";
import type { FileLocks } from "./tree/lock.js";

export interface AppDeps {
  root: string;
  hub: EventHub;
  locks: FileLocks;
  chats: ChatService;
  jobs?: JobRunner;
  search?: SearchIndex;
  settings?: SettingsRouteDeps;
}

type LegacyAppDeps = Omit<AppDeps, "chats">;

export function createApp(deps: AppDeps): Hono;
export function createApp(deps: LegacyAppDeps): Hono;
export function createApp(deps: AppDeps | LegacyAppDeps): Hono {
  const app = new Hono();

  app.route("/api/sets", setsRoutes({ root: deps.root, hub: deps.hub, locks: deps.locks }));
  app.route("/api/sets/:set", inboxRoutes({ root: deps.root, locks: deps.locks, hub: deps.hub }));
  app.route("/api/sets/:set/cards", cardsRoutes({ root: deps.root, locks: deps.locks, hub: deps.hub }));
  app.route("/api/sets/:set/anki", ankiRoutes({ root: deps.root, locks: deps.locks, hub: deps.hub }));
  app.route("/api/sets/:set/highlights", highlightsRoutes({ root: deps.root, locks: deps.locks, hub: deps.hub }));
  app.route("/api/sets/:set", exportRoutes({ root: deps.root, locks: deps.locks, hub: deps.hub }));
  app.route("/api/sets/:set", bookRoutes({ root: deps.root }));
  app.route("/api/events", eventsRoutes(deps.hub));
  app.route("/api/today", todayRoutes({ root: deps.root, jobs: deps.jobs }));

  if (deps.search !== undefined) {
    app.route(
      "/api/search",
      searchRoutes({ root: deps.root, index: deps.search, chats: "chats" in deps ? deps.chats : undefined }),
    );
  }

  if (deps.jobs !== undefined) {
    app.route("/api/jobs", jobsRoutes({ runner: deps.jobs, root: deps.root }));
    app.route("/api/library", libraryRoutes({ root: deps.root, jobs: deps.jobs, hub: deps.hub }));
  }

  if (deps.settings !== undefined) {
    app.route("/api/settings", settingsRoutes({ root: deps.root, locks: deps.locks, ...deps.settings }));
  }

  if ("chats" in deps) {
    app.route("/api/sets/:set/chats", chatRoutes(deps.chats));
  }

  return app;
}
