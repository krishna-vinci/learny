import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { listSetSources } from "../ingest/library.js";
import { refreshSource } from "../ingest/refresh.js";
import { FileLocks } from "../tree/lock.js";
import { createRefreshSourceJob } from "./refresh-source-job.js";

vi.mock("../ingest/refresh.js", () => ({ refreshSource: vi.fn() }));
vi.mock("../ingest/library.js", () => ({ listSetSources: vi.fn() }));
const roots: string[] = [];
afterEach(async () => {
  vi.resetAllMocks();
  await Promise.all(roots.splice(0).map((r) => fs.rm(r, { recursive: true, force: true })));
});
it("continues a set refresh after a source error and reports one aggregate result", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-refresh-job-"));
  roots.push(root);
  vi.mocked(listSetSources).mockResolvedValue([{ id: "lib-broken" }, { id: "lib-good" }] as Awaited<
    ReturnType<typeof listSetSources>
  >);
  vi.mocked(refreshSource)
    .mockRejectedValueOnce(new Error("Source missing"))
    .mockResolvedValueOnce({
      refresh: { sourceId: "lib-good", before: 65, after: 100, status: "refreshed", disappearedAnchors: [] },
      commitSha: "abc",
    });
  const ctx = { signal: new AbortController().signal, progress: vi.fn(), addUsage: vi.fn() };
  const result = await createRefreshSourceJob({ root, locks: new FileLocks() })({ set: "course" }, ctx);
  expect(result?.refreshes?.map((r) => r.status)).toEqual(["skipped", "refreshed"]);
  expect(ctx.progress).toHaveBeenLastCalledWith("1 refreshed; 1 skipped; 0 unchanged");
  expect(ctx.addUsage).not.toHaveBeenCalled();
});
it("rejects ambiguous targets and stops immediately on cancellation", async () => {
  const handler = createRefreshSourceJob({ root: "/unused", locks: new FileLocks() });
  const controller = new AbortController();
  controller.abort();
  const ctx = { signal: controller.signal, progress: vi.fn(), addUsage: vi.fn() };
  await expect(handler({ sourceId: "lib-a", set: "course" }, ctx)).rejects.toThrow("Supply one");
  await expect(handler({ sourceId: "lib-a" }, ctx)).rejects.toThrow();
  expect(refreshSource).not.toHaveBeenCalled();
});
