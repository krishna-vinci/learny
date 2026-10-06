/** M15 real plan/brief/draft on a temp copy. Live data is only read. Keys via node --env-file. */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFrontmatter } from "@studium/shared";
import { parse, stringify } from "yaml";
import { evalRuntime } from "../src/agent/eval-runtime.js";
import { EventHub } from "../src/events.js";
import { parsePlanProposal } from "../src/inbox/plans.js";
import { commonsMetadata, readSourceFigures } from "../src/ingest/figures.js";
import { licenseUrl, pageImageLicense } from "../src/ingest/image-license.js";
import { listSources } from "../src/ingest/library.js";
import { safeFetch } from "../src/ingest/safe-fetch.js";
import { htmlToMarkdown } from "../src/ingest/web.js";
import { createDraftJob } from "../src/jobs/draft-job.js";
import { createPlanJob } from "../src/jobs/plan-job.js";
import { JobRunner } from "../src/jobs/runner.js";
import { McpManager } from "../src/mcp/bridge.js";
import { loadMcpConfig } from "../src/mcp/config.js";
import { parseCurriculum } from "../src/tree/curriculum.js";
import { FileLocks } from "../src/tree/lock.js";
import { YoutubeService } from "../src/youtube/service.js";

const live = process.argv[2];
if (!live) throw new Error("Pass a read-only study tree");
const resume = process.argv[3];
if (resume && !/^\/tmp\/studium-m15-trial-[^/]+$/.test(resume)) throw new Error("Resume only an M15 temp trial");
const out = resume ?? (await fs.mkdtemp(path.join(os.tmpdir(), "studium-m15-trial-")));
const root = path.join(out, "tree");
if (!resume) {
  await fs.cp(live, root, { recursive: true, filter: (p) => !p.includes(`${path.sep}.cache`) });
  await fs.mkdir(path.join(root, ".cache"), { recursive: true });
  await fs.copyFile(path.join(live, ".cache/exa-budget.json"), path.join(root, ".cache/exa-budget.json"));
}
await fs.cp(path.resolve("../skills"), path.join(root, "_global/skills"), { recursive: true });
console.log(`M15 trial: ${out}`);
const configFile = path.join(root, "_global/config.yaml"),
  config = parse(await fs.readFile(configFile, "utf8"));
config.models = {
  default: "openai-codex/gpt-6.1-sol",
  classifier: null,
  roles: {
    outliner: "openai-codex/gpt-6.1-sol",
    drafter: "openai-codex/gpt-6.1-sol",
    checker: "github-copilot/gpt-6-luna",
    librarian: "github-copilot/gpt-6-luna",
  },
};
config.billing = { subscription: ["openai-codex", "github-copilot"] };
await fs.writeFile(configFile, stringify(config));
if (!resume) {
  const rows: unknown[] = [];
  for (const source of await listSources(root)) {
    const before = await readSourceFigures(root, source.id);
    if (!before.length) continue;
    let html = "",
      images: ReturnType<typeof htmlToMarkdown>["images"] = [];
    try {
      if (source.url) {
        const fetched = await safeFetch(source.url, { maxBytes: 5 * 1024 * 1024, httpsOnly: true });
        html = Buffer.from(fetched.bytes).toString("utf8");
        images = htmlToMarkdown(html, fetched.url).images;
      }
      for (const f of before) {
        const commons = await commonsMetadata(f.url).catch(() => undefined);
        const specific = images.find((i) => i.url === f.url);
        const license =
          commons?.license ??
          specific?.license ??
          f.license ??
          (source.url ? pageImageLicense(html, source.url) : undefined);
        if (license) f.license = license;
        f.creator = commons?.creator || f.creator || source.authors.join(", ") || source.title;
        f.sourcePage = commons?.sourcePage || f.sourcePage || source.url || f.url;
        f.licenseUrl = commons?.licenseUrl || licenseUrl(license);
        f.credit = `${f.creator}, ${f.sourcePage}${license ? ` (${license})` : " (licence unknown)"}`;
      }
      const original = await readSourceFigures(live, source.id);
      rows.push({
        id: source.id,
        beforeUnknown: original.filter((f) => !f.license).length,
        afterUnknown: before.filter((f) => !f.license).length,
        unknownToKnown: before.filter((f, i) => !original[i]?.license && !!f.license).length,
        total: before.length,
      });
      await fs.writeFile(path.join(root, `library/${source.id}/images.json`), JSON.stringify(before, null, 2));
    } catch (error) {
      rows.push({ id: source.id, error: error instanceof Error ? error.name : "error" });
    }
    await fs.writeFile(path.join(out, "redetection.json"), JSON.stringify(rows, null, 2));
    console.log(`Redetected ${source.id}`);
  }
}
const adapter = await evalRuntime(path.join(out, "usage.json")),
  hub = new EventHub(),
  locks = new FileLocks();
const mcp = new McpManager(loadMcpConfig(root, process.env).servers);
await mcp.start();
const youtube = new YoutubeService({
  dataDir: path.join(out, "instance"),
  secretsKey: Buffer.alloc(32),
  env: process.env,
});
const deps = { root, locks, mcp, hub, runtime: adapter.runtime, youtube };
const jobs = new JobRunner({ root, hub, maxParallel: 1, subscriptionProviders: ["openai-codex", "github-copilot"] });
jobs.register("plan-set", createPlanJob(deps));
jobs.register("draft-chapter", createDraftJob(deps));
if (resume) await fs.copyFile(path.join(out, "results.json"), path.join(out, `prior-results-${Date.now()}.json`));
const cases: Record<string, unknown>[] = [];
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
async function wait(id: string) {
  while (!["done", "failed", "cancelled"].includes(jobs.get(id)?.status ?? ""))
    await new Promise((r) => setTimeout(r, 1000));
  const result = jobs.get(id);
  if (result?.status !== "done") throw new Error(result?.error ?? "Job failed");
  return result;
}
try {
  for (const set of ["hyderabad-history", "polymers"]) {
    adapter.beginTurn();
    const item: Record<string, unknown> = { set };
    cases.push(item);
    try {
      const plan = parseFrontmatter(await fs.readFile(path.join(root, set, "PLAN.md"), "utf8"));
      const sources = Array.isArray(plan.frontmatter.sources) ? (plan.frontmatter.sources as string[]) : [];
      let curriculum = await fs.readFile(path.join(root, set, "curriculum.md"), "utf8");
      if (!resume) {
        const planned = jobs.enqueue(
          "plan-set",
          {
            set,
            goal: `${plan.frontmatter.title ?? set}. ${plan.body}\nM15 trial: reuse registered sources, plan 1–3 real image slots per chapter where useful. First chapter should teach with a real photograph: ${set === "hyderabad-history" ? "Charminar or Golconda as a concrete introduction to Hyderabad history" : "familiar polyethylene bags or PET bottles and natural rubber as an introduction to polymers"}. Include the existing interactive/video contracts.`,
            level: Number(plan.frontmatter.level ?? 2),
            sources,
          },
          { set, title: "M15 image planning trial" },
        );
        const proposed = await wait(planned.id);
        const proposalPath = proposed.result?.proposalPath;
        if (!proposalPath) throw new Error("Missing plan proposal");
        const proposal = parsePlanProposal(await fs.readFile(path.join(root, set, proposalPath), "utf8"));
        item.proposal = proposalPath;
        // Local trial approves only the selected first chapter for refinement/drafting, rather than enqueuing every chapter.
        await fs.writeFile(path.join(root, set, "PLAN.md"), proposal.plan);
        await fs.writeFile(path.join(root, set, "curriculum.md"), proposal.curriculum);
        curriculum = proposal.curriculum;
      }
      const first = parseCurriculum(curriculum)[0];
      if (!first) throw new Error("Missing first chapter");
      for (const file of await fs.readdir(path.join(root, set, "notes")))
        if (file.endsWith(".md"))
          await fs.rename(path.join(root, set, "notes", file), path.join(out, `${Date.now()}-${set}-${file}`));
      item.chapter = first;
      const draft = jobs.enqueue(
        "draft-chapter",
        {
          set,
          title: first.title,
          brief: `${first.scope}. Fulfil all planned images with local rasters via save_asset and visible Credit titles. Real photos teach what actual monuments/materials look like; do not replace them with an SVG.`,
        },
        { set, title: "M15 real image chapter trial" },
      );
      item.draft = await wait(draft.id);
    } catch (error) {
      item.error = error instanceof Error ? error.message : "Trial failed";
      console.log(`${set}: ${item.error}`);
    }
    await save();
  }
} finally {
  await mcp.stop();
  adapter.close();
  await save();
}
