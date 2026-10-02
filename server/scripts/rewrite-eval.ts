/** Real rewrite jobs on read-only-source copies. Run with node --env-file=... --import tsx.
 * --ledger shares the visual eval's usage ledger and three-identical-failures guard; never uses the app's live tree as a write root.
 */
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual, promisify } from "node:util";
import { parseFrontmatter } from "@studium/shared";
import { stringify } from "yaml";
import { evalRuntime } from "../src/agent/eval-runtime.js";
import { noteLint } from "../src/agent/note-lint.js";
import { EventHub } from "../src/events.js";
import { createRewriteJob, rewriteChange } from "../src/jobs/draft-job.js";
import { McpManager } from "../src/mcp/bridge.js";
import { ensureRepo, log } from "../src/tree/git.js";
import { FileLocks } from "../src/tree/lock.js";

const repo = path.resolve(import.meta.dirname, "../..");
const arg = (flag: string, fallback = "") => {
  const i = process.argv.indexOf(flag);
  return i < 0 ? fallback : process.argv[i + 1] || fallback;
};
const source = arg("--source", "/home/krishna/learny/data/users/krishna");
const out = arg("--out") || (await fs.mkdtemp(path.join(os.tmpdir(), "studium-m11-rewrite-")));
await fs.mkdir(out, { recursive: true });
const previous = arg("--previous-report") ? await fs.readFile(arg("--previous-report"), "utf8") : "";
const adapter = await evalRuntime(arg("--ledger", "/tmp/studium-m11-evidence/calls.json"));
const git = promisify(execFile);
const cases = [
  { set: "hyderabad-history", note: "notes/02-before-hyderabad-deccan-and-golconda.md" },
  { set: arg("--non-history-set", "linear-algebra"), note: arg("--non-history-note", "notes/05-pca-in-practice.md") },
];
const rows: Record<string, unknown>[] = [];
let stage = "Copying study trees";
let checkpointTail = Promise.resolve();
function checkpoint() {
  checkpointTail = checkpointTail.then(async () => {
    await fs.writeFile(path.join(out, "results.json"), JSON.stringify(rows, null, 2));
    const lines = [
      "# M11 rewrite verification",
      "",
      `Stage: ${stage}. Evidence: ${out}. Shared ledger: ${adapter.state.calls} calls recorded (no fixed subscription cap).`,
      "",
      "The actual createRewriteJob handler runs against temporary study-tree copies. Drafter: openai-codex/gpt-6.1-sol; checker: github-copilot/gpt-6-luna (different subscription providers). Classifier/MCP services are off in the temp config. Automatic study-tree snapshot/drafter/checker commits occur only in temp repos.",
      "",
      "Sentence comparison normalizes whitespace/case, removes frontmatter, citation markers, footnote definitions, media declarations and fenced code, then splits on sentence-ending punctuation. New-after fraction and replaced-before fraction must both be >=40%, so merely appending cannot pass.",
      "",
      "Follow-up uses PCA in practice instead of Vectors: the original Strang source still has no parsed.md/parsed/ evidence. PCA's two cited sources have parsed text. The real job permits one shallow-rewrite revision before restoring/failing; checker blocker revision remains independently bounded. A case stops after three identical provider/tool failures, with no fixed subscription request cap.",
      "",
    ];
    for (const row of rows) {
      lines.push(
        `## ${row.set}`,
        "",
        `Result: ${row.verdict ?? "running"}.`,
        "",
        "```json",
        JSON.stringify(row, null, 2),
        "```",
        "",
      );
    }
    lines.push(
      "## Observed tokens per provider",
      "",
      "| Provider | Fresh | Output | Cache read | Cache write |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const [p, u] of Object.entries(adapter.state.usage))
      lines.push(`| ${p} | ${u.fresh} | ${u.output} | ${u.cacheRead} | ${u.cacheWrite} |`);
    lines.push(
      "",
      "Totals below belong to the specified follow-up usage ledger, shared with visual eval when that ledger is used. Historical results and their incomplete interrupted telemetry are preserved separately below.",
      "",
    );
    if (previous) lines.push("## Previous M11 run (before follow-up)", "", previous);
    await fs.writeFile(path.join(repo, "docs/plans/2026-10-02-m11-rewrite-report.md"), lines.join("\n"));
  });
  return checkpointTail;
}
function preserved(note: string) {
  return [
    ...note.matchAll(
      /!\[[^\]]*\]\(([^)]+)\)|^::(?:visual|artifact|youtube)\{[^\n]+\}|^(`{3,}|~{3,})(?:vega-lite|mermaid)\b[^\n]*\n[\s\S]*?^\2\s*$/gm,
    ),
  ].map((m) => m[1] || m[0]);
}
async function mediaHashes(root: string, set: string) {
  const result: Record<string, string> = {};
  for (const folder of ["assets", "artifacts", "visuals"]) {
    const dir = path.join(root, set, folder);
    const visit = async (abs: string): Promise<void> => {
      for (const e of await fs.readdir(abs, { withFileTypes: true }).catch(() => [])) {
        const file = path.join(abs, e.name);
        if (e.isDirectory()) await visit(file);
        else if (e.isFile())
          result[path.relative(root, file)] = createHash("sha256")
            .update(await fs.readFile(file))
            .digest("hex");
      }
    };
    await visit(dir);
  }
  return result;
}
await checkpoint();
console.log(JSON.stringify({ out, calls: adapter.state.calls }));
try {
  for (const c of cases) {
    const root = path.join(out, c.set);
    await fs.mkdir(path.join(root, "_global"), { recursive: true });
    const row: Record<string, unknown> = { set: c.set, note: c.note, root };
    rows.push(row);
    try {
      const rel = `${c.set}/${c.note}`;
      const before = await fs.readFile(path.join(source, rel), "utf8");
      const history = await git("git", ["-C", source, "log", "--format=%h %an %s", "--", rel]);
      row.sourceHistory = history.stdout.trim();
      assert(
        !/drafter: rewrite|rewrite-chapter/i.test(history.stdout),
        "Choose a chapter without a previous rewrite commit",
      );
      await fs.cp(path.join(source, c.set), path.join(root, c.set), {
        recursive: true,
        filter: (src) => !src.split(path.sep).some((p) => [".git", ".cache", "chats"].includes(p)),
      });
      await fs.copyFile(path.join(source, "_global/profile.md"), path.join(root, "_global/profile.md"));
      await fs.cp(path.join(repo, "skills"), path.join(root, "_global/skills"), { recursive: true });
      const fm = parseFrontmatter(before).frontmatter;
      for (const id of fm.sources as string[])
        await fs.cp(path.join(source, "library", id), path.join(root, "library", id), {
          recursive: true,
          filter: (src) => !path.basename(src).startsWith("original."),
        });
      row.parsedSources = await Promise.all(
        (fm.sources as string[]).map(async (id) => {
          const dir = path.join(root, "library", id);
          const entries = await fs.readdir(dir);
          assert(entries.includes("parsed.md") || entries.includes("parsed"), `Missing parsed source: ${id}`);
          return id;
        }),
      );
      await fs.writeFile(
        path.join(root, "_global/config.yaml"),
        stringify({
          models: {
            default: "openai-codex/gpt-6.1-sol",
            roles: { drafter: "openai-codex/gpt-6.1-sol", checker: "github-copilot/gpt-6-luna" },
          },
          billing: { subscription: ["github-copilot", "openai-codex"] },
        }),
      );
      await fs.writeFile(path.join(root, ".gitignore"), ".cache/\n**/original.*\n**/chats/\n");
      await ensureRepo(root);
      const baseline = (await log(root, { limit: 1 }))[0];
      assert(baseline);
      row.beforeCommit = baseline.sha;
      const hashes = await mediaHashes(root, c.set);
      await fs.writeFile(path.join(root, "before.md"), before);
      const providers = new Set<string>(),
        progress: string[] = [];
      row.progress = progress;
      adapter.beginTurn();
      await checkpoint();
      const result = await createRewriteJob({
        root,
        locks: new FileLocks(),
        mcp: new McpManager([]),
        runtime: adapter.runtime,
        hub: new EventHub(),
      })(
        { set: c.set, path: c.note },
        {
          signal: AbortSignal.timeout(600000),
          progress: (text) => {
            stage = `${c.set}: ${text}`;
            progress.push(text);
            console.log(stage);
            void checkpoint();
          },
          addUsage: () => {},
          useProvider: (p) => {
            providers.add(p);
            row.providers = [...providers];
          },
        },
      );
      row.progress = progress;
      row.providers = [...providers];
      row.result = result;
      const after = await fs.readFile(path.join(root, rel), "utf8");
      await fs.writeFile(path.join(root, "after.md"), after);
      const change = rewriteChange(before, after);
      const newRatio = change.newAfterRatio,
        replacedRatio = change.replacedBeforeRatio;
      row.sentences = change;
      row.openings = {
        before: parseFrontmatter(before)
          .body.trim()
          .split(/\n\n/)
          .find((p) => !p.startsWith("#"))
          ?.slice(0, 500),
        after: parseFrontmatter(after)
          .body.trim()
          .split(/\n\n/)
          .find((p) => !p.startsWith("#"))
          ?.slice(0, 500),
      };
      const { status: _oldStatus, ...oldMetadata } = fm,
        { status, ...newMetadata } = parseFrontmatter(after).frontmatter;
      row.metadataPreserved = isDeepStrictEqual(oldMetadata, newMetadata);
      const ids = [...new Set([...before.matchAll(/\[\^src:([^\]]+)\]/g)].map((m) => m[1]))];
      row.citationIdsPreserved = ids.every((id) => after.includes(`[^src:${id}]`));
      const definitions = new Map(
        [...after.matchAll(/^\[\^src:([^\]]+)\]:[ \t]*(.+)$/gm)].map((m) => [m[1], m[2] ?? ""]),
      );
      row.footnotesHumanReadable =
        ids.every((id) => definitions.has(id)) &&
        [...definitions.values()].every(
          (text) => /[^\s]+.*\*/.test(text) && !/(?:parsed(?:\/[^\s]+)?\.md|source\.md|lines? \d+[–-]\d+)/i.test(text),
        );
      row.figuresDeclarationsPreserved = preserved(before).every((value) => after.includes(value));
      const afterHashes = await mediaHashes(root, c.set);
      row.mediaBytesPreserved = Object.entries(hashes).every(([file, hash]) => afterHashes[file] === hash);
      row.noteLint = noteLint(rel, after);
      const commits = await log(root, { path: rel, limit: 6 });
      row.commits = commits;
      const draftCommit = commits.find((commit) => commit.author === "drafter");
      const checkCommit = commits.find((commit) => commit.author === "checker");
      row.statusAfter = status;
      if (draftCommit)
        row.statusAtDrafterCommit = parseFrontmatter(
          (await git("git", ["-C", root, "show", `${draftCommit.sha}:${rel}`])).stdout,
        ).frontmatter.status;
      row.oldTextRecoverable = (await git("git", ["-C", root, "show", `${baseline.sha}:${rel}`])).stdout === before;
      const claims = [
        newRatio >= 0.4 && replacedRatio >= 0.4,
        row.metadataPreserved,
        row.citationIdsPreserved,
        row.footnotesHumanReadable,
        row.figuresDeclarationsPreserved,
        row.mediaBytesPreserved,
        (row.noteLint as string[]).length === 0,
        status === "checked",
        row.statusAtDrafterCommit === "draft",
        !!draftCommit && !!checkCommit,
        row.oldTextRecoverable,
      ];
      row.assertions = { passed: claims.filter(Boolean).length, total: claims.length };
      row.verdict = claims.every(Boolean) ? "PASS" : "FAIL";
      await checkpoint();
      console.log(
        JSON.stringify({
          set: c.set,
          verdict: row.verdict,
          sentences: row.sentences,
          assertions: row.assertions,
          calls: adapter.state.calls,
        }),
      );
    } catch (e) {
      row.verdict = "BLOCKED";
      row.error = e instanceof Error ? e.message : String(e);
      await checkpoint();
      console.log(JSON.stringify({ set: c.set, error: row.error, calls: adapter.state.calls }));
    }
  }
} finally {
  stage = "Finished";
  await checkpoint();
  adapter.close();
}
