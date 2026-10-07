/** Controlled before/after replay of the recorded Jev corpus. Never writes live data. */
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { ConfigYaml, parseFrontmatter } from "@studium/shared";
import { parse as parseYaml } from "yaml";
import { listSkills } from "../src/agent/builtins/skills.js";
import { compactHistory } from "../src/agent/history.js";
import { createModelRuntime, resolveRoleModel } from "../src/agent/models.js";
import { selectedPassage } from "../src/agent/passage.js";
import { promptBreakdown } from "../src/agent/prompt-audit.js";
import { ROLES, type RoleName } from "../src/agent/roles.js";
import { roleToolset } from "../src/agent/run-role.js";
import { McpManager } from "../src/mcp/bridge.js";
import { evidencePack, rankedPassages, renderPassages, sourcePassages } from "../src/search/passages.js";
import { FileLocks } from "../src/tree/lock.js";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) => {
  const i = args.indexOf(name);
  return i < 0 ? fallback : (args[i + 1] ?? fallback);
};
const source = arg("--source", "");
if (!source) throw new Error("Pass --source with a temporary users-directory copy");
const real = args.includes("--real");
const budget = Number(arg("--budget", "1.75"));
if (!(budget > 0 && budget <= 1.75)) throw new Error("Invalid budget");
const tutorOnly = args.includes("--tutor-only");
const output = path.resolve(arg("--output", "../docs/plans/2026-10-02-m10-token-efficiency-audit.json"));
const corpus = JSON.parse(await fs.readFile("../docs/plans/2026-10-02-jev-classifier-spike-results.json", "utf8"));
const scratch = await fs.mkdtemp(path.join(os.tmpdir(), "studium-m10-audit-"));
const runtime = real ? await createModelRuntime() : null;
const rows: unknown[] = [];
let costUsd = 0;
let upperBoundUsd = 0;
const checkpoint = () =>
  fs.writeFile(
    output,
    `${JSON.stringify({ real, estimate: "characters/4; controlled replay, not complete production jobs", costUsd, upperBoundUsd, scratch, rows }, null, 2)}\n`,
  );
try {
  const groups = [
    ...new Map(
      corpus.items.map((r: { user: string; set: string; file: string; kind: string }) => [`${r.user}/${r.file}`, r]),
    ).values(),
  ] as { user: string; set: string; file: string; kind: string }[];
  for (const user of [...new Set(groups.map((g) => g.user))]) {
    await fs.cp(path.join(source, user), path.join(scratch, user), {
      recursive: true,
      filter: (p) => !p.split(path.sep).some((s) => [".git", ".cache", "chats"].includes(s)),
      dereference: false,
    });
  }
  // Include one chapter-outline replay and one long tutor replay in addition to all 17 historical review batches.
  const first = groups.find((g) => g.kind === "section");
  if (!first) throw new Error("No chapter in corpus");
  const workload = [
    ...groups.map((g) => ({ ...g, role: (g.kind === "card" ? "critic" : "checker") as RoleName })),
    { ...first, role: "drafter" as const },
    { ...first, role: "tutor" as const },
  ];
  for (const g of tutorOnly ? workload.filter((g) => g.role === "tutor") : workload) {
    const root = path.join(scratch, g.user);
    const note = await fs.readFile(path.join(root, g.file), "utf8");
    const sources = parseFrontmatter(note).frontmatter.sources;
    const ids = Array.isArray(sources) ? sources.filter((s): s is string => typeof s === "string") : [];
    const skills = await listSkills(root, [...ROLES[g.role].skills]);
    const system = await ROLES[g.role].promptBuilder({ root, set: g.set, skills });
    const tools = roleToolset(g.role, {
      root,
      set: g.set,
      locks: new FileLocks(),
      mcp: new McpManager([]),
      holder: "audit",
      canWrite: () => false,
    }).tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
    const whole = tutorOnly ? "" : renderPassages(await sourcePassages(root, ids));
    const pack =
      g.role === "checker"
        ? renderPassages((await evidencePack(root, note, ids)).passages)
        : g.role === "drafter"
          ? renderPassages(await rankedPassages(root, ids, note.slice(0, 2000)))
          : whole;
    for (const phase of ["before", "after"] as const) {
      const old =
        g.role === "tutor"
          ? Array.from({ length: 20 }, (_, i) => [
              {
                role: "user" as const,
                content: `Earlier question ${i}\n${tutorOnly ? note.slice(0, 1800) : note}`,
                timestamp: i * 2,
              },
              {
                role: "assistant" as const,
                api: "openai-completions",
                provider: "zai",
                model: "glm-5.3-flash",
                stopReason: "stop" as const,
                usage: {
                  input: 0,
                  output: 0,
                  cacheRead: 0,
                  cacheWrite: 0,
                  totalTokens: 0,
                  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                },
                content: [
                  {
                    type: "text" as const,
                    text: `Earlier explanation ${i}\n${tutorOnly ? note.slice(0, 1800) : note}`,
                  },
                ],
                timestamp: i * 2 + 1,
              },
            ]).flat()
          : [];
      const history = phase === "after" ? compactHistory(old) : old;
      const context = {
        messages: [
          { role: "system" as const, content: system, toolsAdded: tools, timestamp: 0 },
          ...history,
          {
            role: "user" as const,
            content: `Controlled audit replay: provide a concise ${g.role === "drafter" ? "chapter outline" : g.role === "tutor" ? "explanation" : "review with likely issues"} of this target. Do not call tools or mutate files; inspect the supplied evidence.\n${selectedPassage(note, g.file)}\n${phase === "after" ? pack : whole}`,
            timestamp: Date.now(),
          },
        ],
      };
      const buckets = promptBreakdown(context as never);
      const row: Record<string, unknown> = {
        role: g.role,
        phase,
        file: g.file,
        buckets,
        estimatedTokens: Object.values(buckets).reduce((a, b) => a + b, 0),
      };
      rows.push(row);
      if (runtime) {
        // Same affordable review model for every controlled comparison. Every attempt is reserved before sending.
        const config = ConfigYaml.parse(parseYaml(await fs.readFile(path.join(root, "_global/config.yaml"), "utf8")));
        const model = resolveRoleModel(runtime, config, "checker");
        const reserve =
          (2 *
            Buffer.byteLength(JSON.stringify(context)) *
            Math.max(model.cost.input, model.cost.cacheRead, model.cost.cacheWrite) +
            1024 * model.cost.output) /
          1e6;
        if (
          costUsd + upperBoundUsd + reserve > budget ||
          (row.estimatedTokens as number) > model.contextWindow - 2048
        ) {
          row.skipped = "budget or model context bound";
        } else {
          upperBoundUsd += reserve;
          await checkpoint();
          const start = performance.now();
          try {
            const stream = runtime.streamSimple(model, context as never, {
              maxTokens: 1024,
              cacheRetention: "long",
              signal: AbortSignal.timeout(60_000),
            });
            const result = await stream.result();
            row.usage = result.usage;
            row.stopReason = result.stopReason;
            row.model = `${model.provider}/${model.id}`;
            row.ms = performance.now() - start;
            costUsd += result.usage.cost.total;
            upperBoundUsd -= reserve;
          } catch {
            row.error = "provider request failed; details omitted";
          }
        }
      }
      await checkpoint();
      console.log(
        JSON.stringify({
          role: g.role,
          phase,
          estimatedTokens: row.estimatedTokens,
          costUsd,
          stopReason: row.stopReason,
          skipped: row.skipped,
        }),
      );
    }
  }
} finally {
  await checkpoint();
  await fs.rm(scratch, { recursive: true, force: true });
}
