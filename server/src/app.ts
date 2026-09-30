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
import { type PracticeRoutesDeps, practiceRoutes } from "./routes/practice.js";
import { searchRoutes } from "./routes/search.js";
import { setsRoutes } from "./routes/sets.js";
import { type SettingsRouteDeps, settingsRoutes } from "./routes/settings.js";
import { todayRoutes } from "./routes/today.js";
import type { SearchIndex } from "./search/index.js";
import { changedPaths } from "./tree/git.js";
import type { FileLocks } from "./tree/lock.js";
import { canonicalRel, PathError } from "./tree/paths.js";

export interface AppDeps {
  root: string;
  hub: EventHub;
  locks: FileLocks;
  chats: ChatService;
  jobs?: JobRunner;
  practice?: Pick<PracticeRoutesDeps, "agent" | "grader" | "gradingTimeoutMs">;
  search?: SearchIndex;
  settings?: SettingsRouteDeps;
}

type LegacyAppDeps = Omit<AppDeps, "chats">;

export function createApp(deps: AppDeps): Hono;
export function createApp(deps: LegacyAppDeps): Hono;
export function createApp(deps: AppDeps | LegacyAppDeps): Hono {
  const app = new Hono();

  // Raw file/history APIs must not bypass the practice API's answer projections.
  const privatePracticePath = (rel: string) => /^[^/]+\/practice\/(quizzes|problems)(?:\/|$)/.test(rel);
  for (const endpoint of ["file", "diff"]) {
    app.get(`/api/sets/:set/${endpoint}`, async (c, next) => {
      try {
        const rel = c.req.query("path");
        const target = rel ? canonicalRel(deps.root, `${c.req.param("set")}/${rel}`) : undefined;
        if (target !== undefined && privatePracticePath(target))
          return c.json({ error: "Use the practice API to view practice content" }, 403);
        if (endpoint === "diff" && c.req.query("sha")) {
          const paths = await changedPaths(deps.root, c.req.query("sha") as string);
          // Git accepts directories and wildcards as pathspecs, not only individual files.
          const includesPrivate = paths.some(
            (p) =>
              privatePracticePath(p) &&
              (target === undefined || /[*?[\]]/.test(rel ?? "") || p === target || p.startsWith(`${target}/`)),
          );
          if (includesPrivate) return c.json({ error: "Select a non-practice file to view this diff" }, 403);
        }
      } catch (error) {
        if (error instanceof PathError) return c.json({ error: "invalid path" }, 400);
        // Existing routes handle malformed SHAs and unavailable history.
      }
      return next();
    });
  }

  app.route("/api/sets", setsRoutes({ root: deps.root, hub: deps.hub, locks: deps.locks }));
  app.route("/api/sets/:set", inboxRoutes({ root: deps.root, locks: deps.locks, hub: deps.hub, jobs: deps.jobs }));
  app.route("/api/sets/:set/cards", cardsRoutes({ root: deps.root, locks: deps.locks, hub: deps.hub }));
  app.route("/api/sets/:set/anki", ankiRoutes({ root: deps.root, locks: deps.locks, hub: deps.hub }));
  app.route("/api/sets/:set/highlights", highlightsRoutes({ root: deps.root, locks: deps.locks, hub: deps.hub }));
  app.route("/api/sets/:set", exportRoutes({ root: deps.root, locks: deps.locks, hub: deps.hub }));
  app.route("/api/sets/:set", bookRoutes({ root: deps.root }));
  app.route(
    "/api/sets/:set/practice",
    practiceRoutes({ root: deps.root, locks: deps.locks, hub: deps.hub, jobs: deps.jobs, ...deps.practice }),
  );
  app.route("/api/events", eventsRoutes(deps.hub));
  app.route("/api/today", todayRoutes({ root: deps.root, jobs: deps.jobs }));

  if (deps.search !== undefined) {
    app.route(
      "/api/search",
      searchRoutes({ root: deps.root, index: deps.search, chats: "chats" in deps ? deps.chats : undefined }),
    );
  }

  if (deps.jobs !== undefined) {
    app.route("/api/jobs", jobsRoutes({ runner: deps.jobs, root: deps.root, hub: deps.hub }));
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
