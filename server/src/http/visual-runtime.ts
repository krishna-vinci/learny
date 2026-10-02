import { promises as fs } from "node:fs";
import path from "node:path";
import { Hono } from "hono";
/** Public library files only. No workspace delegate, cookies or learner content. */
export function visualRuntimeRoutes(webRoot: string) {
  const app = new Hono();
  app.get("/:file", async (c) => {
    const file = c.req.param("file");
    if (!/^(?:p5|d3|three|studium-runtime)\.[a-f0-9]{12}\.js$/.test(file) && file !== "manifest.json")
      return c.notFound();
    try {
      const bytes = await fs.readFile(path.join(webRoot, "visual-runtime", file));
      c.header("Content-Type", file.endsWith(".js") ? "application/javascript; charset=utf-8" : "application/json");
      c.header("Cache-Control", file === "manifest.json" ? "no-cache" : "public, max-age=31536000, immutable");
      c.header("Access-Control-Allow-Origin", "*");
      c.header("X-Content-Type-Options", "nosniff");
      return c.body(bytes);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return c.notFound();
      throw e;
    }
  });
  return app;
}
