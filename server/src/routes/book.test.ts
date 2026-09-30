import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { bookRoutes } from "./book.js";

let root: string;
let app: Hono;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-book-route-"));
  await fs.mkdir(path.join(root, "alpha/.cache/book"), { recursive: true });
  await fs.writeFile(path.join(root, "alpha/PLAN.md"), "# Alpha");
  app = new Hono();
  app.route("/api/sets/:set", bookRoutes({ root }));
});
afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("book download", () => {
  it("streams the cached PDF and HEAD exposes its size and mtime without a body", async () => {
    const pdf = path.join(root, "alpha/.cache/book/alpha.pdf");
    const bytes = Buffer.from("%PDF-1.7\nbook bytes");
    await fs.writeFile(pdf, bytes);
    const modified = (await fs.stat(pdf)).mtime.toUTCString();
    const get = await app.request("/api/sets/alpha/book.pdf");
    expect(get.status).toBe(200);
    expect(get.headers.get("content-type")).toBe("application/pdf");
    expect(get.headers.get("content-disposition")).toBe('attachment; filename="alpha.pdf"');
    expect(Buffer.from(await get.arrayBuffer())).toEqual(bytes);
    const head = await app.request("/api/sets/alpha/book.pdf", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("last-modified")).toBe(modified);
    expect(head.headers.get("content-length")).toBe(String(bytes.length));
    expect(await head.text()).toBe("");
  });

  it("returns 404 for an unbuilt book, traversal, reserved set or cache symlink", async () => {
    for (const method of ["GET", "HEAD"]) {
      expect((await app.request("/api/sets/alpha/book.pdf", { method })).status).toBe(404);
    }
    for (const set of ["..%2foutside", "library", "%00", "missing"]) {
      expect([400, 404]).toContain((await app.request(`/api/sets/${set}/book.pdf`)).status);
    }
    await fs.symlink(path.join(root, "alpha/PLAN.md"), path.join(root, "alpha/.cache/book/alpha.pdf"));
    expect((await app.request("/api/sets/alpha/book.pdf")).status).toBe(404);
  });
});
