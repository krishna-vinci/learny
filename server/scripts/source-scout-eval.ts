/** Live M12 comparison, isolated copies, subscription runtime ledger + three-identical-failure guard. */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFrontmatter } from "@studium/shared";
import { stringify } from "yaml";
import { evalRuntime } from "../src/agent/eval-runtime.js";
import { EventHub } from "../src/events.js";
import { parsePlanProposal } from "../src/inbox/plans.js";
import { readParsedFile, readSource } from "../src/ingest/library.js";
import { scoreParseQuality } from "../src/ingest/quality.js";
import { createPlanJob } from "../src/jobs/plan-job.js";
import { McpManager } from "../src/mcp/bridge.js";
import { loadMcpConfig } from "../src/mcp/config.js";
import { ensureRepo } from "../src/tree/git.js";
import { FileLocks } from "../src/tree/lock.js";

const copy = process.argv[2];
if (!copy?.startsWith("/tmp/studium-m12-")) throw new Error("Pass an M12 temp copy");
const out = await fs.mkdtemp(path.join(os.tmpdir(), "studium-m12-scout-"));
const report = path.resolve("../docs/plans/2026-10-04-m12-source-comparison.md");
const rows: string[] = [];
const adapter = await evalRuntime(path.join(out, "usage.json"));
const checkpoint = () =>
  fs.writeFile(
    report,
    [
      "# M12 recipe/scouting comparison",
      "",
      `Temporary runs: ${out}. The application's real Outliner runs with source recipes and scout_sources. Search/fetch outputs are discovery data; registered evidence remains separate.`,
      "",
      ...rows,
      "",
      "## Provider usage",
      "",
      "| Provider | Fresh | Output | Cache read | Cache write |",
      "| --- | ---: | ---: | ---: | ---: |",
      ...Object.entries(adapter.state.usage).map(
        ([p, u]) => `| ${p} | ${u.fresh} | ${u.output} | ${u.cacheRead} | ${u.cacheWrite} |`,
      ),
      "",
    ].join("\n"),
  );
await checkpoint();
const checkpointTimer = setInterval(() => {
  void checkpoint();
}, 30000);
console.log(`Scouting evidence: ${out}`);
for (const set of ["polymers", "hyderabad-history", "linear-algebra"]) {
  adapter.beginTurn();
  const root = path.join(out, set);
  await fs.cp(copy, root, { recursive: true, dereference: true });
  await fs.cp(path.resolve("../skills"), path.join(root, "_global/skills"), { recursive: true });
  const configFile = path.join(root, "_global/config.yaml");
  await fs.writeFile(
    configFile,
    stringify({
      models: {
        default: "openai-codex/gpt-6.1-sol",
        classifier: null,
        roles: { outliner: "openai-codex/gpt-6.1-sol" },
      },
      billing: { subscription: ["openai-codex", "github-copilot"] },
    }),
  );
  await ensureRepo(root);
  const loaded = loadMcpConfig(root, process.env);
  const mcp = new McpManager(loaded.servers);
  await mcp.start();
  const plan = parseFrontmatter(await fs.readFile(path.join(root, set, "PLAN.md"), "utf8"));
  const ids = Array.isArray(plan.frontmatter.sources) ? (plan.frontmatter.sources as string[]) : [];
  rows.push(`## ${set}`, "", "Current imported sources (parse-health scores):", "");
  for (const id of ids) {
    const view = await readSource(root, id);
    const text = (
      await Promise.all((view?.parsedFiles ?? []).map(async (f) => (await readParsedFile(root, id, f)) ?? ""))
    ).join("\n");
    rows.push(`- ${id}: **${scoreParseQuality(text).score}**, ${view?.source.url ?? "no URL"}`);
  }
  await checkpoint();
  try {
    const result = await createPlanJob({
      root,
      mcp,
      runtime: adapter.runtime,
      hub: new EventHub(),
      locks: new FileLocks(),
    })(
      {
        set,
        goal: `${plan.frontmatter.title ?? set}. ${plan.body}`,
        level: typeof plan.frontmatter.level === "number" ? plan.frontmatter.level : 2,
        sources: ids,
      },
      {
        signal: AbortSignal.timeout(900000),
        progress: (s) => console.log(`${set}: ${s}`),
        addUsage: () => {},
        useProvider: () => {},
      },
    );
    const proposal = parsePlanProposal(await fs.readFile(path.join(root, set, result.proposalPath ?? ""), "utf8"));
    rows.push(
      "",
      "Proposed sources and reasons (the saved proposal is available in the temporary tree):",
      "",
      ...proposal.sourcesToAdd.map((s) => `- ${s}`),
    );
  } catch (error) {
    rows.push(
      "",
      `Run failed: ${error instanceof Error ? error.name : "error"}. See temporary evidence; no secrets copied to this report.`,
    );
  } finally {
    await mcp.stop();
    await checkpoint();
  }
}
clearInterval(checkpointTimer);
adapter.close();
