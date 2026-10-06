/** Real M14b Refresh/rewrite on a temporary copy, with a provider loop guard and usage ledger. */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse, stringify } from "yaml";
import { evalRuntime } from "../src/agent/eval-runtime.js";
import { EventHub } from "../src/events.js";
import { readSourceFigures } from "../src/ingest/figures.js";
import { refreshSource } from "../src/ingest/refresh.js";
import { createDraftJob, createRewriteJob } from "../src/jobs/draft-job.js";
import { JobRunner } from "../src/jobs/runner.js";
import { McpManager } from "../src/mcp/bridge.js";
import { loadMcpConfig } from "../src/mcp/config.js";
import { FileLocks } from "../src/tree/lock.js";
import { YoutubeService } from "../src/youtube/service.js";

const live = process.argv[2];
if (!live) throw new Error("Pass the read-only study tree");
const resumeRoot = process.argv[3];
const rewriteTrial = process.argv[4] === "rewrite";
if (resumeRoot && !/^\/tmp\/studium-m14b-trial-[^/]+\/tree$/.test(resumeRoot))
  throw new Error("Resume only an M14b temporary copy");
const out = resumeRoot ? path.dirname(resumeRoot) : await fs.mkdtemp(path.join(os.tmpdir(), "studium-m14b-trial-"));
const root = resumeRoot ?? path.join(out, "tree");
if (!resumeRoot) {
  await fs.cp(live, root, {
    recursive: true,
    filter: (p) => !p.includes(`${path.sep}.cache${path.sep}`) && !p.endsWith(`${path.sep}.cache`),
  });
  await fs.cp(path.resolve("../skills"), path.join(root, "_global/skills"), { recursive: true });
  await fs.mkdir(path.join(root, ".cache"), { recursive: true });
  await fs.copyFile(path.join(live, ".cache/exa-budget.json"), path.join(root, ".cache/exa-budget.json"));
}
const configFile = path.join(root, "_global/config.yaml");
const config = parse(await fs.readFile(configFile, "utf8"));
config.models = {
  default: "openai-codex/gpt-6.1-sol",
  classifier: null,
  roles: {
    outliner: "openai-codex/gpt-6.1-sol",
    drafter: "openai-codex/gpt-6.1-sol",
    librarian: "github-copilot/gpt-6-luna",
    checker: "github-copilot/gpt-6-luna",
  },
};
config.billing = { subscription: ["openai-codex", "github-copilot"] };
await fs.writeFile(configFile, stringify(config));
const rows: unknown[] = resumeRoot ? JSON.parse(await fs.readFile(path.join(out, "refresh.json"), "utf8")) : [];
const hub = new EventHub(),
  locks = new FileLocks();
console.log(`M14b trial: ${out}`);
for (const id of resumeRoot
  ? []
  : [
      "lib-pressbooks-20-1-hydrocarbons-general",
      "lib-pressbooks-8-2-drawing-and-interpreting",
      "lib-openstax-21-1-hydrocarbons-chemistry-atoms",
      "lib-chemguide-how-to-draw-organic-molecules",
    ]) {
  const before = await readSourceFigures(root, id);
  const result = await refreshSource(
    {
      root,
      locks,
      blockedHosts: new Map(),
      firecrawlUrl: process.env.FIRECRAWL_API_URL,
      firecrawlKey: process.env.FIRECRAWL_API_KEY,
      signal: AbortSignal.timeout(180000),
    },
    id,
  ).catch((e) => ({ refresh: { status: "failed", reason: e.message } }));
  const after = await readSourceFigures(root, id);
  const row = {
    id,
    before: { candidates: before.length, saved: before.filter((f) => f.path).length },
    after: { candidates: after.length, saved: after.filter((f) => f.path).length },
    refresh: result.refresh,
    failures: after.filter((f) => f.downloadError).map((f) => ({ url: f.url, reason: f.downloadError })),
  };
  rows.push(row);
  await fs.writeFile(path.join(out, "refresh.json"), JSON.stringify(rows, null, 2));
  console.log(JSON.stringify(row));
}
const curriculumFile = path.join(root, "polymers/curriculum.md");
const previousCurriculum = await fs.readFile(curriculumFile, "utf8");
const curriculum = previousCurriculum.includes("step-through widget — The same carbon chain")
  ? previousCurriculum
  : previousCurriculum.replace(
      "  Visual: figure — Highlighted functional groups in polymer-related molecules",
      "  Visual: figure — Highlighted functional groups in polymer-related molecules\n  Visual: step-through widget — The same carbon chain in displayed, condensed and skeletal conventions; step and predict implicit hydrogens\n  Visual: sketch — Recognize alkene, alcohol, carboxylic acid, amine, ester and amide groups; select and compare highlighted atoms",
    );
await fs.writeFile(curriculumFile, curriculum);
const adapter = await evalRuntime(path.join(out, "usage.json"));
const mcp = new McpManager(loadMcpConfig(root, process.env).servers);
await mcp.start();
const youtube = new YoutubeService({
  dataDir: path.join(out, "instance"),
  secretsKey: Buffer.alloc(32),
  env: process.env,
});
const jobs = new JobRunner({ root, hub, maxParallel: 1, subscriptionProviders: ["openai-codex", "github-copilot"] });
jobs.register("rewrite-chapter", createRewriteJob({ root, locks, hub, runtime: adapter.runtime, mcp, youtube }));
jobs.register("draft-chapter", createDraftJob({ root, locks, hub, runtime: adapter.runtime, mcp, youtube }));
const save = () =>
  fs.writeFile(
    path.join(out, "results.json"),
    JSON.stringify({ root, refresh: rows, jobs: jobs.list(), usage: adapter.state }, null, 2),
  );
hub.subscribe((e) => {
  if (e.type === "job") {
    console.log(`${e.job.kind}: ${e.job.status} ${e.job.progress}`);
    void save();
  }
});
try {
  adapter.beginTurn();
  if (!rewriteTrial) {
    if (resumeRoot) await fs.copyFile(path.join(out, "results.json"), path.join(out, "previous-results.json"));
    await fs.copyFile(
      path.join(root, "polymers/notes/03-carbon-structures-and-reactive-groups.md"),
      path.join(out, "prior-chapter.md"),
    );
    await fs.unlink(path.join(root, "polymers/notes/03-carbon-structures-and-reactive-groups.md"));
  }
  const job = !rewriteTrial
    ? jobs.enqueue(
        "draft-chapter",
        {
          set: "polymers",
          title: "Carbon structures and reactive groups",
          brief:
            "Fulfil the four planned visuals, including both interactive attachments. Use complete make-visual templates for stepping through molecular drawing conventions and selecting/comparing functional groups.",
        },
        { set: "polymers", title: "M14b chapter 03 redraft" },
      )
    : jobs.enqueue(
        "rewrite-chapter",
        { set: "polymers", path: "notes/03-carbon-structures-and-reactive-groups.md" },
        { set: "polymers", title: "M14b chapter 03" },
      );
  while (!["done", "failed", "cancelled"].includes(jobs.get(job.id)?.status ?? ""))
    await new Promise((r) => setTimeout(r, 1000));
  await save();
  console.log(JSON.stringify({ out, result: jobs.get(job.id), usage: adapter.state }));
} finally {
  await mcp.stop();
  adapter.close();
  await save();
}
