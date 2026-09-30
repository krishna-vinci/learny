import { promises as fs } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { Readable } from "node:stream";
import { Hono } from "hono";
import { bookPdfPath } from "../jobs/book-paths.js";

export function bookRoutes(deps: { root: string }): Hono {
  const app = new Hono();
  app.on(["GET", "HEAD"], "/book.pdf", async (c) => {
    let file: FileHandle | undefined;
    try {
      const set = c.req.param("set") ?? "";
      file = await fs.open(await bookPdfPath(deps.root, set), "r");
      const stat = await file.stat();
      if (!stat.isFile()) {
        await file.close();
        return c.json({ error: "not found" }, 404);
      }
      const headers = {
        "content-type": "application/pdf",
        "content-disposition": `attachment; filename="${set}.pdf"`,
        "content-length": String(stat.size),
        "last-modified": stat.mtime.toUTCString(),
        "cache-control": "private, no-cache",
      };
      if (c.req.method === "HEAD") {
        await file.close();
        return c.body(null, 200, headers);
      }
      return new Response(Readable.toWeb(file.createReadStream()) as ReadableStream, { status: 200, headers });
    } catch {
      await file?.close().catch(() => undefined);
      return c.json({ error: "not found" }, 404);
    }
  });
  return app;
}
