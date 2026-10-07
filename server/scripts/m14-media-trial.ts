/** Real plan → approval/kickoff → brief → draft on one temporary copy. No fixed call cap. */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { type JobView, parseFrontmatter } from "@studium/shared";
import { parse as parseYaml, stringify } from "yaml";
import { evalRuntime } from "../src/agent/eval-runtime.js";
import { createApp } from "../src/app.js";
import { EventHub } from "../src/events.js";
import { defaultPlanKickoffsFile, PlanKickoffs } from "../src/inbox/plan-kickoffs.js";
import { parsePlanProposal } from "../src/inbox/plans.js";
import { publicErrorReason } from "../src/ingest/error-reason.js";
import { createDraftJob } from "../src/jobs/draft-job.js";
import { createIngestJob } from "../src/jobs/ingest-job.js";
import { createPlanJob } from "../src/jobs/plan-job.js";
import { JobRunner } from "../src/jobs/runner.js";
import { McpManager } from "../src/mcp/bridge.js";
import { loadMcpConfig } from "../src/mcp/config.js";
import { FileLocks } from "../src/tree/lock.js";
import { YoutubeService } from "../src/youtube/service.js";

const copy = process.argv[2];
if (!copy?.startsWith("/tmp/studium-m14-refresh-")) throw new Error("Pass the M14 Refresh temporary copy");
const out = await fs.mkdtemp(path.join(os.tmpdir(), "studium-m14-trial-"));
const root = path.join(out, "tree");
await fs.cp(copy, root, { recursive: true });
await fs.cp(path.resolve("../skills"), path.join(root, "_global/skills"), { recursive: true });
// Retain the live workspace's budget estimate; do not reset the shared key allowance for a trial.
await fs.mkdir(path.join(root, ".cache"), { recursive: true });
await fs.copyFile(path.join(copy, ".cache/exa-budget.json"), path.join(root, ".cache/exa-budget.json")).catch((e) => {
  if (e.code !== "ENOENT") throw e;
});
const configFile = path.join(root, "_global/config.yaml");
const config = parseYaml(await fs.readFile(configFile, "utf8"));
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
const adapter = await evalRuntime(path.join(out, "usage.json"));
const hub = new EventHub(),
  locks = new FileLocks();
const mcp = new McpManager(loadMcpConfig(root, process.env).servers);
await mcp.start();
const dataDir = path.join(out, "instance");
await fs.mkdir(path.join(dataDir, "bin"), { recursive: true });
await fs
  .copyFile(path.resolve(process.env.STUDIUM_DATA_DIR ?? "../data", "bin/yt-dlp"), path.join(dataDir, "bin/yt-dlp"))
  .catch((e) => {
    if (e.code !== "ENOENT") throw e;
  });
const youtube = new YoutubeService({ dataDir, secretsKey: Buffer.alloc(32), env: process.env });
const deps = { root, locks, mcp, hub, runtime: adapter.runtime, youtube };
const jobs = new JobRunner({ root, hub, maxParallel: 1, subscriptionProviders: ["openai-codex", "github-copilot"] });
jobs.register("ingest", createIngestJob(deps));
jobs.register("plan-set", createPlanJob(deps));
jobs.register("draft-chapter", createDraftJob(deps));
const kickoffs = new PlanKickoffs({ root, hub, jobs, file: defaultPlanKickoffsFile(root) });
const app = createApp({ root, locks, hub, jobs, planKickoffs: kickoffs });
const cases: unknown[] = [];
const save = () =>
  fs.writeFile(
    path.join(out, "results.json"),
    JSON.stringify({ root, cases, jobs: jobs.list(), usage: adapter.state }, null, 2),
  );
hub.subscribe((event) => {
  if (event.type === "job") {
    console.log(`${event.job.set}: ${event.job.kind} ${event.job.status} ${event.job.progress}`);
    void save();
  }
});
console.log(`M14 trial evidence: ${out}`);
async function waitJob(id: string) {
  const terminal = () => jobs.get(id)?.status;
  while (!["done", "failed", "cancelled"].includes(terminal() ?? ""))
    await new Promise((resolve) => setTimeout(resolve, 1000));
  const job = jobs.get(id);
  if (job?.status !== "done") throw new Error(job?.error ?? "Job did not complete");
  return job;
}
try {
  for (const set of ["polymers", "hyderabad-history"]) {
    adapter.beginTurn();
    const row: Record<string, unknown> = { set };
    cases.push(row);
    try {
      const plan = parseFrontmatter(await fs.readFile(path.join(root, set, "PLAN.md"), "utf8"));
      const sources = Array.isArray(plan.frontmatter.sources) ? (plan.frontmatter.sources as string[]) : [];
      const planned = jobs.enqueue(
        "plan-set",
        {
          set,
          goal: `${plan.frontmatter.title ?? set}. ${plan.body}\nPlan 1–2 visuals and at least one quality video need per chapter, per D36. Reuse supplied registered sources; only propose missing evidence.`,
          level: typeof plan.frontmatter.level === "number" ? plan.frontmatter.level : 2,
          sources,
        },
        { set, title: "M14 plan trial" },
      );
      const proposed = await waitJob(planned.id);
      const proposalPath = proposed.result?.proposalPath;
      if (!proposalPath) throw new Error("No plan proposal produced");
      row.proposal = proposalPath;
      const proposal = parsePlanProposal(await fs.readFile(path.join(root, set, proposalPath), "utf8"));
      row.chapters = proposal.chapters;
      // Remove only this temp copy's first chapter, so approval drafts exactly one new chapter.
      const notes = path.join(root, set, "notes");
      for (const file of await fs.readdir(notes)) if (/^01-.*\.md$/.test(file)) await fs.unlink(path.join(notes, file));
      const response = await app.request(`/api/sets/${set}/plan-proposals/${path.basename(proposalPath)}/approve`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ draftFirst: 1, addSources: true }),
      });
      if (!response.ok) throw new Error(`Approval HTTP ${response.status}`);
      row.approval = await response.json();
      let draft: JobView | undefined;
      while (!draft) {
        const failed = jobs
          .list()
          .find((j) => j.set === set && j.id.startsWith("plan-kickoff:") && j.status === "failed");
        if (failed) throw new Error(failed.error);
        draft = jobs.list().find((j) => j.set === set && j.kind === "draft-chapter");
        if (!draft) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      const finished = await waitJob(draft.id);
      row.draft = finished;
      if (finished.result?.notePath) {
        const note = await fs.readFile(path.join(root, set, finished.result.notePath), "utf8");
        row.status = parseFrontmatter(note).frontmatter.status;
        row.mediaAttachments = [...note.matchAll(/^(?:!\[|::(?:visual|artifact|youtube)\{).+$/gm)].map((m) => m[0]);
      }
    } catch (error) {
      row.error = publicErrorReason(error);
      console.log(`${set}: trial stopped: ${row.error}`);
    }
    await save();
  }
} finally {
  kickoffs.dispose();
  await mcp.stop();
  adapter.close();
  await save();
}
