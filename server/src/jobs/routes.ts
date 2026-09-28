import { Hono } from "hono";
import type { JobRunner } from "./runner.js";

export interface JobsRoutesDeps {
  runner: JobRunner;
}

export function jobsRoutes(deps: JobsRoutesDeps): Hono {
  const app = new Hono();

  app.get("/", (c) => {
    const set = c.req.query("set");
    return c.json(deps.runner.list(set === undefined || set === "" ? undefined : set));
  });

  app.post("/:id/cancel", (c) => {
    const id = c.req.param("id");
    if (deps.runner.get(id) === undefined) return c.json({ error: "not found" }, 404);
    if (!deps.runner.cancel(id)) return c.json({ error: "not cancellable" }, 409);
    return c.body(null, 204);
  });

  return app;
}
