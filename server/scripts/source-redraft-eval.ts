/** M12 real redraft on a temporary copy; no production writes and no request cap. */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseFrontmatter } from "@studium/shared";
import { stringify } from "yaml";
import { evalRuntime } from "../src/agent/eval-runtime.js";
import { reviewVideoEvidence } from "../src/agent/video-evidence.js";
import { EventHub } from "../src/events.js";
import { createDraftJob } from "../src/jobs/draft-job.js";
import { McpManager } from "../src/mcp/bridge.js";
import { loadMcpConfig } from "../src/mcp/config.js";
import { ensureRepo } from "../src/tree/git.js";
import { FileLocks } from "../src/tree/lock.js";

const copy = process.argv[2];
if (!copy?.startsWith("/tmp/studium-m12-")) throw new Error("Pass M12 temporary copy");
const out = await fs.mkdtemp(path.join(os.tmpdir(), "studium-m12-redraft-"));
const root = path.join(out, "tree");
await fs.cp(copy, root, { recursive: true, dereference: true });
await fs.cp(path.resolve("../skills"), path.join(root, "_global/skills"), { recursive: true });
await fs.writeFile(
  path.join(root, "_global/config.yaml"),
  stringify({
    models: {
      default: "openai-codex/gpt-6.1-sol",
      classifier: null,
      roles: {
        outliner: "openai-codex/gpt-6.1-sol",
        drafter: "openai-codex/gpt-6.1-sol",
        librarian: "github-copilot/gpt-6-luna",
        checker: "github-copilot/gpt-6-luna",
      },
    },
    billing: { subscription: ["openai-codex", "github-copilot"] },
  }),
);
await ensureRepo(root);
const beforePath = "polymers/notes/01-polymers-from-carbon-bonds-to-everyday.md";
const before = await fs.readFile(path.join(root, beforePath), "utf8");
const beforeUncertain = (before.match(/Uncertain:/g) ?? []).length;
const title = String(parseFrontmatter(before).frontmatter.title ?? "Polymers: chains and everyday properties");
const adapter = await evalRuntime(path.join(out, "usage.json"));
const loaded = loadMcpConfig(root, process.env);
const mcp = new McpManager(loaded.servers);
await mcp.start();
let stage = "Starting redraft",
  result: unknown = null;
const report = path.resolve("../docs/plans/2026-10-04-m12-redraft.md");
const save = () =>
  fs.writeFile(
    report,
    [
      "# M12 polymers redraft",
      "",
      `Stage: ${stage}. Temporary tree: ${root}. Ledger: ${out}/usage.json.`,
      "",
      `Original: ${beforePath}; Uncertain: count **${beforeUncertain}**.`,
      "",
      "```json",
      JSON.stringify(result, null, 2),
      "```",
      "",
      "| Provider | Fresh | Output | Cache read | Cache write |",
      "| --- | ---: | ---: | ---: | ---: |",
      ...Object.entries(adapter.state.usage).map(
        ([p, u]) => `| ${p} | ${u.fresh} | ${u.output} | ${u.cacheRead} | ${u.cacheWrite} |`,
      ),
      "",
    ].join("\n"),
  );
await save();
const timer = setInterval(() => {
  void save();
}, 30000);
console.log(`Redraft evidence: ${out}`);
try {
  const drafted = await createDraftJob({
    root,
    mcp,
    runtime: adapter.runtime,
    hub: new EventHub(),
    locks: new FileLocks(),
  })(
    {
      set: "polymers",
      title,
      brief:
        "Carbon bonding, monomers and repeat units, chain-growth and step-growth polymerization, cross-linking, glass transition, and structure-property relationships. A concrete beginner explanation of everyday materials with examples; assess missing evidence before drafting. Video only if a physical process or worked example teaches better than text.",
    },
    {
      signal: AbortSignal.timeout(1200000),
      progress: (s) => {
        stage = s;
        console.log(s);
        void save();
      },
      addUsage: () => {},
      useProvider: () => {},
    },
  );
  if (!drafted?.notePath) throw new Error("No redrafted note returned");
  const note = await fs.readFile(path.join(root, "polymers", drafted.notePath), "utf8");
  const review = await reviewVideoEvidence(root, "polymers", note);
  result = {
    notePath: `polymers/${drafted.notePath}`,
    status: parseFrontmatter(note).frontmatter.status,
    beforeUncertain,
    afterUncertain: (note.match(/Uncertain:/g) ?? []).length,
    sources: parseFrontmatter(note).frontmatter.sources,
    moments: [...note.matchAll(/^::youtube\{.*\}/gm)].map((m) => m[0]),
    videoReview: review,
  };
  stage = "Finished";
} catch (error) {
  stage = "Failed";
  result = { error: error instanceof Error ? error.name : "error", beforeUncertain };
} finally {
  clearInterval(timer);
  await mcp.stop();
  adapter.close();
  await save();
}
