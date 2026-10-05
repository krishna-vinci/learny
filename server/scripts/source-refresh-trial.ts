/** Read production library metadata; write only a fresh, isolated temporary copy. */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { mapConcurrent } from "../src/concurrency.js";
import { listSources, readParsedFile, readSource } from "../src/ingest/library.js";
import { scoreParseQuality } from "../src/ingest/quality.js";
import { refreshSource } from "../src/ingest/refresh.js";
import { ensureRepo } from "../src/tree/git.js";
import { FileLocks } from "../src/tree/lock.js";

const live = process.argv[2];
if (!live) throw new Error("Pass the read-only source study tree");
const root = await fs.mkdtemp(path.join(os.tmpdir(), "studium-m13-refresh-"));
const report = path.resolve("../docs/plans/2026-10-05-m13-refresh-trial.md");
const sources = [];
for (const s of await listSources(live)) {
  const v = await readSource(live, s.id);
  const text = (
    await Promise.all((v?.parsedFiles ?? []).map(async (f) => (await readParsedFile(live, s.id, f)) ?? ""))
  ).join("\n\n");
  sources.push({ ...s, before: scoreParseQuality(text).score });
}
sources.sort((a, b) => a.before - b.before || a.id.localeCompare(b.id));
const chosen = sources.slice(0, 10);
await fs.mkdir(path.join(root, "library"));
await fs.writeFile(path.join(root, ".gitignore"), "**/original.*\n.cache/\n");
for (const s of chosen)
  await fs.cp(path.join(live, "library", s.id), path.join(root, "library", s.id), { recursive: true });
await ensureRepo(root);
const locks = new FileLocks(),
  blockedHosts = new Map<string, string>();
const rows: string[] = [];
async function save() {
  await fs.writeFile(
    report,
    [
      "# M13 refresh trial",
      "",
      `Temporary copy: ${root}. Ten lowest parse-health sources from the read-only library. Existing id, citation and anchor checks use the real refresh helper. No production writes or model calls.`,
      "",
      "| Source | Before | After | Result | Disappeared anchors |",
      "| --- | ---: | ---: | --- | --- |",
      ...rows,
      "",
      "Exa requests/spend: 0/$0. Model usage (all providers): fresh 0, output 0, cache read 0, cache write 0.",
      "",
    ].join("\n"),
  );
}
console.log(`Refresh copy: ${root}`);
await mapConcurrent(chosen, 3, async (s) => {
  const result = await refreshSource(
    {
      root,
      locks,
      blockedHosts,
      firecrawlUrl: process.env.FIRECRAWL_API_URL,
      firecrawlKey: process.env.FIRECRAWL_API_KEY,
      mineruUrl: process.env.MINERU_URL,
      signal: AbortSignal.timeout(75000),
    },
    s.id,
  ).catch((e) => ({
    refresh: {
      sourceId: s.id,
      before: s.before,
      after: s.before,
      status: "skipped",
      disappearedAnchors: [],
      reason: e instanceof Error ? e.name : "error",
    },
  }));
  const r = result.refresh;
  rows.push(
    `| ${s.id} | ${r.before} | ${r.after} | ${r.status}${r.reason ? `: ${r.reason.replace(/[\r\n|]/g, " ")}` : ""} | ${r.disappearedAnchors.join(", ") || "none"} |`,
  );
  await save();
  console.log(`${s.id}: ${r.before} → ${r.after}, ${r.status}`);
});
await save();
