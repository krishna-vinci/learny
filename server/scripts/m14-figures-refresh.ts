/** M14 evidence: Refresh only a temporary copy of the owner's study tree. */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mapConcurrent } from "../src/concurrency.js";
import { readSourceFigures } from "../src/ingest/figures.js";
import { listSources } from "../src/ingest/library.js";
import { refreshSource } from "../src/ingest/refresh.js";
import { FileLocks } from "../src/tree/lock.js";

const live = process.argv[2];
if (!live) throw new Error("Pass the read-only study tree path");
const only = process.argv[3]?.split(",");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-m14-refresh-"));
await fs.cp(live, root, {
  recursive: true,
  filter: (file) => !file.includes(`${path.sep}.cache${path.sep}`) && !file.endsWith(`${path.sep}.cache`),
});
console.log(`Refresh copy: ${root}`);
const rows: unknown[] = [];
const locks = new FileLocks(),
  blockedHosts = new Map<string, string>();
await mapConcurrent(
  (await listSources(root)).filter((source) => !only || only.includes(source.id)),
  3,
  async (source) => {
    const result = await refreshSource(
      {
        root,
        locks,
        blockedHosts,
        firecrawlUrl: process.env.FIRECRAWL_API_URL,
        firecrawlKey: process.env.FIRECRAWL_API_KEY,
        mineruUrl: process.env.MINERU_URL,
        signal: AbortSignal.timeout(120000),
      },
      source.id,
    ).catch((error) => ({ refresh: { status: "skipped", reason: error instanceof Error ? error.name : "error" } }));
    const figures = await readSourceFigures(root, source.id);
    rows.push({
      sourceId: source.id,
      ...result.refresh,
      captured: figures.filter((f) => f.path).length,
      candidates: figures.length,
      licenses: Object.fromEntries(
        [...new Set(figures.map((f) => f.license ?? "unknown"))].map((license) => [
          license,
          figures.filter((f) => (f.license ?? "unknown") === license).length,
        ]),
      ),
    });
    await fs.writeFile(path.join(root, "m14-refresh-results.json"), JSON.stringify(rows, null, 2));
    console.log(
      `${source.id}: ${result.refresh.status}, ${figures.filter((f) => f.path).length} captured / ${figures.length} candidates`,
    );
  },
);
