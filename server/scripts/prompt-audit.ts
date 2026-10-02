import { readFile } from "node:fs/promises";
import { BUCKETS, type PromptBuckets } from "../src/agent/prompt-audit.js";

const file = process.argv[2] ?? ".cache/prompt-audit.jsonl";
const rows = (await readFile(file, "utf8"))
  .trim()
  .split("\n")
  .filter(Boolean)
  .flatMap((line) => {
    try {
      return [JSON.parse(line)];
    } catch {
      return [];
    }
  });
const requests = new Map(rows.filter((r) => r.event === "request").map((r) => [r.id, r]));
const groups = new Map<
  string,
  {
    role: string;
    model: string;
    billing: string;
    calls: number;
    buckets: PromptBuckets;
    freshInput: number;
    cacheRead: number;
    cacheWrite: number;
    output: number;
    catalogCostEstimateUsd: number;
    chargeEstimateUsd: number;
  }
>();
for (const r of rows) {
  const request = requests.get(r.id) ?? r;
  const key = `${request.role}/${request.model}`;
  const group = groups.get(key) ?? {
    role: request.role,
    model: request.model,
    billing: request.billing ?? "unknown",
    calls: 0,
    buckets: Object.fromEntries(BUCKETS.map((b) => [b, 0])) as PromptBuckets,
    freshInput: 0,
    cacheRead: 0,
    cacheWrite: 0,
    output: 0,
    catalogCostEstimateUsd: 0,
    chargeEstimateUsd: 0,
  };
  if (r.event === "request") {
    group.calls++;
    for (const b of BUCKETS) group.buckets[b] += r.buckets[b] ?? 0;
  }
  if (r.event === "result") {
    group.freshInput += r.usage.input;
    group.cacheRead += r.usage.cacheRead;
    group.cacheWrite += r.usage.cacheWrite;
    group.output += r.usage.output;
    group.catalogCostEstimateUsd += r.usage.cost.total;
    group.chargeEstimateUsd += group.billing === "subscription" ? 0 : r.usage.cost.total;
  }
  groups.set(key, group);
}
console.log(
  JSON.stringify(
    [...groups.values()].map((r) => ({
      ...r,
      cachedShare: r.cacheRead / (r.freshInput + r.cacheRead + r.cacheWrite || 1),
      topBuckets: Object.entries(r.buckets).sort((a, b) => b[1] - a[1]),
    })),
    null,
    2,
  ),
);
