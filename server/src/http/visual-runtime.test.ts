import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { visualRuntimeRoutes } from "./visual-runtime.js";

it("serves only hashed public libraries without a session and permits opaque-origin CORS", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "runtime-test-"));
  try {
    await fs.mkdir(path.join(root, "visual-runtime"));
    await fs.writeFile(path.join(root, "visual-runtime/p5.012345abcdef.js"), "window.p5 = {};");
    const app = visualRuntimeRoutes(root);
    const response = await app.request("/p5.012345abcdef.js");
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=31536000, immutable");
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.headers.get("set-cookie")).toBeNull();
    expect((await app.request("/private.html")).status).toBe(404);
    expect((await app.request("/p5.aaaaaaaaaaaa.js")).status).toBe(404);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
