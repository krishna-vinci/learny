import type { ClassifierResult } from "@earendil-works/pi-ai";

export interface PairRow {
  id: string;
  kind: "card" | "section";
  baseline: {
    batchId: string;
    verdict: string;
    usage: { input: number; output: number; cacheRead: number; cacheWrite: number; costUsd: number };
  };
  jev: {
    stopReason: ClassifierResult["stopReason"];
    verdict: string | number | null;
    confidence: number;
    answers: ClassifierResult["answers"];
    usage: ClassifierResult["usage"] | null;
    ms: number;
  } | null;
  agreement: boolean | null;
}
export function escalatesAt(row: PairRow, threshold: number): boolean {
  const j = row.jev;
  if (j?.stopReason !== "stop" || j.confidence < threshold) return true;
  if (row.kind === "section") return j.verdict !== "no-claims";
  const formed = j.answers.formed;
  const duplicate = j.answers.duplicate;
  return (
    j.verdict !== "ok" ||
    formed?.type !== "bool" ||
    formed.probability < 0.5 ||
    duplicate?.type !== "bool" ||
    duplicate.probability >= 0.5
  );
}
const tokenCount = (u: PairRow["baseline"]["usage"]) => u.input + u.output + u.cacheRead + u.cacheWrite;
function wilsonUpper(errors: number, n: number): number | null {
  if (!n) return null;
  const z = 1.959963984540054;
  const p = errors / n;
  return (p + (z * z) / (2 * n) + z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / (1 + (z * z) / n);
}
export function summarizePairs(all: PairRow[], kind: PairRow["kind"], threshold = 0.85) {
  const rows = all.filter((r) => r.kind === kind);
  const calls = rows.filter((r) => r.jev);
  const paired = calls.filter((r) => r.jev?.stopReason === "stop" && r.agreement !== null);
  const baselineTokens = rows.reduce((n, r) => n + tokenCount(r.baseline.usage), 0);
  const baselineCostUsd = rows.reduce((n, r) => n + r.baseline.usage.costUsd, 0);
  const usageComplete = calls.length > 0 && calls.every((r) => r.jev?.usage);
  const jevTokens = usageComplete ? calls.reduce((n, r) => n + (r.jev?.usage?.totalTokens ?? 0), 0) : null;
  const inputTokens = usageComplete ? calls.reduce((n, r) => n + (r.jev?.usage?.input ?? 0), 0) : null;
  const groups = new Map<string, PairRow[]>();
  for (const r of rows) {
    const members = groups.get(r.baseline.batchId) ?? [];
    members.push(r);
    groups.set(r.baseline.batchId, members);
  }
  const sweep = [0.5, 0.7, 0.85, 0.9, 0.95, 0.99, 1.01].map((t) => {
    const auto = paired.filter((r) => !escalatesAt(r, t));
    const errors = auto.filter((r) => r.agreement === false).length;
    const bypassed = [...groups.values()].filter((members) => members.every((r) => !escalatesAt(r, t)));
    const savedTokens = bypassed.reduce(
      (n, members) => n + members.reduce((sum, r) => sum + tokenCount(r.baseline.usage), 0),
      0,
    );
    const savedCostUsd = bypassed.reduce(
      (n, members) => n + members.reduce((sum, r) => sum + r.baseline.usage.costUsd, 0),
      0,
    );
    const allPaired = paired.length === rows.length;
    return {
      threshold: t,
      autoItems: auto.length,
      autoDisagreements: errors,
      autoErrorRate: auto.length ? errors / auto.length : null,
      autoErrorWilson95Upper: wilsonUpper(errors, auto.length),
      bypassedGroups: bypassed.length,
      savedLlmTokens: savedTokens,
      savedLlmCostUsd: savedCostUsd,
      pipelineTokens: allPaired && jevTokens !== null ? baselineTokens - savedTokens + jevTokens : null,
      tokenSavingsPercent: allPaired && jevTokens !== null ? (100 * (savedTokens - jevTokens)) / baselineTokens : null,
      freePipelineCostUsd: allPaired ? baselineCostUsd - savedCostUsd : null,
      listPipelineCostUsd:
        allPaired && inputTokens !== null ? baselineCostUsd - savedCostUsd + (inputTokens * 0.042) / 1e6 : null,
    };
  });
  const bins = [0, 0.5, 0.7, 0.85, 0.95].map((lower, index, edges) => {
    const upper = edges[index + 1] ?? 1.000001;
    const items = paired.filter((r) => (r.jev?.confidence ?? 0) >= lower && (r.jev?.confidence ?? 0) < upper);
    return {
      lower,
      upper: Math.min(1, upper),
      n: items.length,
      agreement: items.length ? items.filter((r) => r.agreement).length / items.length : null,
      meanConfidence: items.length ? items.reduce((n, r) => n + (r.jev?.confidence ?? 0), 0) / items.length : null,
    };
  });
  const latencies = calls.map((r) => r.jev?.ms ?? 0).sort((a, b) => a - b);
  return {
    n: rows.length,
    calls: calls.length,
    paired: paired.length,
    failed: calls.length - paired.length,
    agreement: paired.length ? paired.filter((r) => r.agreement).length / paired.length : null,
    disagreements: paired.filter((r) => r.agreement === false).length,
    baselineTokens,
    baselineCostUsd,
    jevTokens,
    inputTokens,
    jevFreeCostUsd: usageComplete ? calls.reduce((n, r) => n + (r.jev?.usage?.cost.total ?? 0), 0) : null,
    jevListCostUsd: inputTokens === null ? null : (inputTokens * 0.042) / 1e6,
    calibration: bins,
    thresholdSweep: sweep,
    selectedThreshold: threshold,
    selected: sweep.find((s) => s.threshold === threshold) ?? null,
    classifyMs: {
      min: latencies[0] ?? null,
      median: latencies.length
        ? ((latencies[Math.floor((latencies.length - 1) / 2)] ?? 0) +
            (latencies[Math.floor(latencies.length / 2)] ?? 0)) /
          2
        : null,
      p95: latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? null,
      max: latencies.at(-1) ?? null,
    },
  };
}
