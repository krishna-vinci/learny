import { createReadStream, promises as fs } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono } from "hono";
import JSZip from "jszip";

export interface ExportRoutesDeps {
  /** Resolves a user's study-tree root, or null when the tree does not exist. */
  rootFor(username: string): string | null;
}

/** Directories never included in the export unless git history is requested. */
function excludedDir(name: string, withHistory: boolean): boolean {
  if (name === ".git") return !withHistory;
  return name === ".cache" || name === "chats";
}

async function addDirectory(zip: JSZip, root: string, relDir: string, withHistory: boolean): Promise<void> {
  const absolute = relDir === "" ? root : path.join(root, relDir);
  const entries = await fs.readdir(absolute, { withFileTypes: true });
  for (const entry of entries) {
    const rel = relDir === "" ? entry.name : `${relDir}/${entry.name}`;
    if (entry.isDirectory()) {
      if (excludedDir(entry.name, withHistory)) continue;
      await addDirectory(zip, root, rel, withHistory);
      continue;
    }
    if (!entry.isFile()) continue;
    zip.file(rel, createReadStream(path.join(root, rel)));
  }
}

/**
 * Streams a zip of the signed-in user's study tree. The archive is generated with
 * `generateNodeStream` so large trees are not buffered in memory.
 */
export function exportRoutes(deps: ExportRoutesDeps): Hono {
  const app = new Hono();

  app.get("/", async (c) => {
    const user = c.get("user");
    const root = deps.rootFor(user.username);
    if (root === null) return c.json({ error: "study tree not found" }, 404);
    const withHistory = c.req.query("withHistory") === "1";

    const zip = new JSZip();
    await addDirectory(zip, root, "", withHistory);
    const stream = zip.generateNodeStream({ type: "nodebuffer", streamFiles: true });
    const date = new Date().toISOString().slice(0, 10);
    return c.body(Readable.toWeb(stream as Readable) as ReadableStream, 200, {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="studium-${user.username}-${date}.zip"`,
    });
  });

  return app;
}
