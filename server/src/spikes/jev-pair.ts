/** Classifier-only continuation: reuses saved real role verdicts, never calls a chat model. */
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ClassifierResult } from "@earendil-works/pi-ai";
import { parseCardFile } from "@studium/shared";
import { createModelRuntime } from "../agent/models.js";
import { decision, questions, sections } from "./jev-spike-lib.js";

const args = process.argv.slice(2);
const arg = (name: string, fallback: string) =>
  args.includes(name) ? (args[args.indexOf(name) + 1] ?? fallback) : fallback;
const data = path.resolve(arg("--data", "/home/krishna/learny/data/users"));
const baselinePath = path.resolve(
  arg(
    "--baseline",
    fileURLToPath(new URL("../../../docs/plans/2026-10-02-jev-classifier-spike-results.json", import.meta.url)),
  ),
);
const output = path.resolve(arg("--output", baselinePath));
if (output === data || output.startsWith(`${data}${path.sep}`))
  throw new Error("Output must be outside read-only data");
const smoke = args.includes("--smoke");
const dryRun = args.includes("--dry-run");
const limit = Number(arg("--limit", smoke ? "1" : "117"));
if (!Number.isInteger(limit) || limit < 1 || limit > 117)
  throw new Error("Invalid limit; maximum is saved 117-item roster");
type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number };
type Jev = ReturnType<typeof decision> & {
  provider: string;
  model: string;
  api: string;
  stopReason: ClassifierResult["stopReason"];
  answers: ClassifierResult["answers"];
  usage: ClassifierResult["usage"] | null;
  ms: number;
  httpStatus: number | null;
  attempts: number;
  error: string | null;
};
type Row = {
  id: string;
  user: string;
  set: string;
  file: string;
  kind: "card" | "section";
  text: string;
  baseline: { batchId: string; verdict: string; usage: Usage; usageAttribution: string };
  jev: Jev | null;
  agreement: boolean | null;
  savedTokens: number | null;
  pairing?: { sha256: string; contextSha256: string; bytes: number; prefixMatches: boolean };
};
const result = JSON.parse(await fs.readFile(baselinePath, "utf8")) as {
  items: Row[];
  baseline: unknown;
  metrics: unknown;
  status: string;
  [key: string]: unknown;
};
if (
  result.items.length !== 117 ||
  result.items.filter((r) => r.kind === "card").length !== 34 ||
  result.items.filter((r) => r.kind === "section").length !== 83 ||
  result.items.some((r) => !r.baseline?.verdict)
)
  throw new Error("Expected complete saved 34-card/83-section baseline");
const loaded = new Map<Row, { text: string; context: string }>();
const notes = new Map<string, string>();
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
for (const row of result.items) {
  const root = path.join(data, row.user);
  const full = await fs.readFile(path.join(root, row.file), "utf8");
  let text: string | undefined;
  let context = full;
  if (row.kind === "card") {
    const parsed = parseCardFile(full);
    text = parsed.cards.find((c) => c.id === row.id)?.body;
    if (!parsed.note) throw new Error(`No context note for ${row.id}`);
    context = await fs.readFile(path.join(root, row.set, parsed.note), "utf8");
  } else {
    const n = Number(row.id.match(/#section-(\d+)$/)?.[1]);
    text = sections(full)[n - 1];
    notes.set(`${row.user}/${row.file}`, full);
  }
  if (text === undefined || text.slice(0, 300) !== row.text)
    throw new Error(`Saved corpus prefix differs: ${row.user}/${row.file}/${row.id}`);
  row.pairing = { sha256: sha(text), contextSha256: sha(context), bytes: Buffer.byteLength(text), prefixMatches: true };
  loaded.set(row, { text, context });
}
const runtime = await createModelRuntime();
// A continuation may NEVER spend on the baseline, even accidentally.
runtime.streamSimple = () => {
  throw new Error("Chat requests disabled in classifier-only continuation");
};
const model = runtime.getModelsOfType("classifier", "opencode").find((m) => m.id === "jev-1.13-free");
if (!model) throw new Error("opencode/jev-1.13-free missing from installed Pi catalog");
const authConfigured = Boolean(process.env.OPENCODE_API_KEY) || runtime.hasConfiguredAuth("opencode");
if (!dryRun && !authConfigured) throw new Error("blocked on OPENCODE_API_KEY");
result.pairingRun = {
  mode: smoke ? "smoke" : dryRun ? "dry-run" : "full",
  startedAt: new Date().toISOString(),
  baselineReused: true,
  extraBaselineCalls: 0,
  extraBaselineCostUsd: 0,
  authConfigured,
  model: {
    id: model.id,
    provider: model.provider,
    api: model.api,
    cost: model.cost,
    contextWindow: model.contextWindow,
  },
  roster: { cards: 34, sections: 83, practiceAnswers: 0 },
  corpusValidation:
    "all saved 300-character prefixes match; original full-content hashes were not recorded, so equivalence beyond prefixes is not provable",
  limit,
};
const persist = async () => {
  await fs.writeFile(output, `${JSON.stringify(result, null, 2)}\n`);
};
console.log(
  JSON.stringify({
    mode: smoke ? "smoke" : dryRun ? "dry-run" : "full",
    model: model.id,
    api: model.api,
    authConfigured,
    roster: 117,
    baselineReused: true,
  }),
);
if (dryRun) {
  await persist();
  process.exit(0);
}
let calls = 0;
let throttles = 0;
let failures = 0;
let consecutiveFailures = 0;
const ordering = smoke
  ? [...result.items.filter((r) => r.kind === "card"), ...result.items.filter((r) => r.kind === "section")]
  : result.items;
for (const row of ordering) {
  if (calls >= limit) break;
  if (row.jev?.stopReason === "stop") continue;
  const content = loaded.get(row);
  if (!content) throw new Error("Missing corpus item");
  const state = {
    target: { id: row.id, text: content.text },
    context: content.context,
    batch:
      row.kind === "card"
        ? result.items
            .filter((r) => r.kind === "card" && r.user === row.user && r.set === row.set)
            .map((r) => ({ id: r.id, text: loaded.get(r)?.text ?? "" }))
        : [],
  };
  let lastStatus: number | null = null;
  let attempts = 0;
  let retryAfterMs = 0;
  const start = performance.now();
  // SDK retries disabled here: explicit bounded backoff is visible in results.
  let classified: ClassifierResult | undefined;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      classified = await runtime.classify(
        model,
        { state, questions: questions(row.kind) },
        {
          signal: AbortSignal.timeout(45_000),
          maxRetries: 0,
          fetch: async (input, init) => {
            attempts++;
            const response = await globalThis.fetch(input, init);
            lastStatus = response.status;
            const header = response.headers.get("retry-after");
            const seconds = Number(header);
            retryAfterMs = header
              ? Number.isFinite(seconds)
                ? seconds * 1000
                : Math.max(0, Date.parse(header) - Date.now())
              : 0;
            return response;
          },
        },
      );
    } catch {
      classified = undefined;
    }
    if (lastStatus !== 429) break;
    throttles++;
    if (attempt < 2)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(45_000, Math.max(retryAfterMs, 5000 * 2 ** attempt))),
      );
  }
  const error =
    classified?.stopReason === "stop"
      ? null
      : lastStatus
        ? `HTTP ${lastStatus}; provider details omitted`
        : "Classifier failed; provider details omitted";
  const d = classified ? decision(row.kind, classified) : { verdict: null, confidence: 0, escalated: true };
  row.jev = {
    provider: classified?.provider ?? model.provider,
    model: classified?.model ?? model.id,
    api: classified?.api ?? model.api,
    stopReason: classified?.stopReason ?? "error",
    answers: classified?.answers ?? {},
    usage: classified?.usage ?? null,
    ms: performance.now() - start,
    httpStatus: lastStatus,
    attempts,
    error,
    ...d,
  };
  row.agreement =
    row.jev.stopReason === "stop"
      ? row.kind === "card"
        ? (d.verdict === "ok" ? "ok" : "reject") === row.baseline.verdict
        : d.verdict === row.baseline.verdict
      : null;
  calls++;
  if (error) {
    failures++;
    consecutiveFailures++;
  } else consecutiveFailures = 0;
  result.pairingProgress = {
    callsThisProcess: calls,
    successful: result.items.filter((r) => r.jev?.stopReason === "stop").length,
    failures,
    throttles,
  };
  await persist();
  console.log(
    JSON.stringify({
      id: row.id,
      kind: row.kind,
      stopReason: row.jev.stopReason,
      httpStatus: lastStatus,
      ms: Math.round(row.jev.ms),
      verdict: d.verdict,
      confidence: d.confidence,
      agreement: row.agreement,
    }),
  );
  if (smoke || lastStatus === 401 || lastStatus === 403 || lastStatus === 429 || consecutiveFailures >= 3) break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
result.status = result.items.every((r) => r.jev?.stopReason === "stop")
  ? "paired-complete"
  : smoke
    ? "smoke-complete"
    : "paired-partial";
result.pairingCompletedAt = new Date().toISOString();
await persist();
