/** Offline summary of the saved paired run; never loads provider credentials or calls models. */
import { promises as fs } from "node:fs";
import { fileURLToPath } from "node:url";
import { escalatesAt, type PairRow, summarizePairs } from "./jev-pair-metrics.js";

const file =
  process.argv[2] ??
  fileURLToPath(new URL("../../../docs/plans/2026-10-02-jev-classifier-spike-results.json", import.meta.url));
const result = JSON.parse(await fs.readFile(file, "utf8"));
const rows: PairRow[] = result.items;
result.metrics = { card: summarizePairs(rows, "card"), section: summarizePairs(rows, "section") };
const groups = new Map<string, PairRow[]>();
for (const r of rows) {
  const group = groups.get(r.baseline.batchId) ?? [];
  group.push(r);
  groups.set(r.baseline.batchId, group);
}
for (const members of groups.values()) {
  const bypassed = members.every((r) => !escalatesAt(r, 0.85));
  for (const r of members)
    (r as PairRow & { savedTokens: number }).savedTokens = bypassed
      ? r.baseline.usage.input + r.baseline.usage.output + r.baseline.usage.cacheRead + r.baseline.usage.cacheWrite
      : 0;
}
result.pairingAssessment = {
  recommendedProductionThreshold: 1.01,
  meaning:
    "disable automatic bypass; 0.85 produced an unsafe auto-accept and stricter thresholds are not validated on a holdout",
  observedCardNoCoverageThreshold: 0.9,
  verdict: "do-not-implement",
  baselineReused: true,
  extraBaselineCalls: 0,
  extraSpendUsd: 0,
};
result.schemaVersion = 2;
const metrics = result.metrics;
const baselineTokens = metrics.card.baselineTokens + metrics.section.baselineTokens;
const jevTokens = metrics.card.jevTokens + metrics.section.jevTokens;
const savedLlmTokens = metrics.card.selected.savedLlmTokens + metrics.section.selected.savedLlmTokens;
result.overall = {
  paired: metrics.card.paired + metrics.section.paired,
  agreement:
    (metrics.card.paired - metrics.card.disagreements + metrics.section.paired - metrics.section.disagreements) /
    rows.length,
  disagreements: metrics.card.disagreements + metrics.section.disagreements,
  baselineTokens,
  jevTokens,
  savedLlmTokens,
  jevPlusEscalationTokens: baselineTokens - savedLlmTokens + jevTokens,
  tokenSavingsPercent: (100 * (savedLlmTokens - jevTokens)) / baselineTokens,
  baselineCostUsd: metrics.card.baselineCostUsd + metrics.section.baselineCostUsd,
  jevFreeCostUsd: metrics.card.jevFreeCostUsd + metrics.section.jevFreeCostUsd,
  jevListCostUsd: metrics.card.jevListCostUsd + metrics.section.jevListCostUsd,
  freePipelineCostUsd: metrics.card.selected.freePipelineCostUsd + metrics.section.selected.freePipelineCostUsd,
  listPipelineCostUsd: metrics.card.selected.listPipelineCostUsd + metrics.section.selected.listPipelineCostUsd,
  counterfactual: true,
};
await fs.writeFile(file, `${JSON.stringify(result, null, 2)}\n`);
console.log(JSON.stringify(result.metrics));
