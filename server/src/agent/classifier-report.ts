import { isDeepStrictEqual } from "node:util";

export interface ClassifierLogRow {
  event: string;
  id: string;
  decision: string;
  confidence?: number;
  answer?: unknown;
  outcome?: unknown;
  source?: string;
  reason?: string;
  latencyMs?: number;
  mode?: string;
  model?: string | null;
  billing?: string;
  usage?: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: { total: number } } | null;
}
function comparable(decision: string, answer: unknown, outcome: unknown): boolean | null {
  if (
    decision === "cards.prescreen" &&
    typeof answer === "object" &&
    answer &&
    typeof outcome === "object" &&
    outcome
  ) {
    const a = answer as Record<string, { verdict: string }>;
    const o = outcome as Record<string, { verdict: string }>;
    const ids = Object.keys(o).filter((id) => a[id]);
    return ids.length ? ids.every((id) => a[id]?.verdict === o[id]?.verdict) : null;
  }
  if (decision === "ingest.kind") {
    const a = answer as { kind?: string };
    const o = outcome as { kind?: string };
    return typeof a?.kind === "string" && typeof o?.kind === "string" ? a.kind === o.kind : null;
  }
  return outcome === undefined || outcome === null ? null : isDeepStrictEqual(answer, outcome);
}
export function summarizeClassifier(rows: ClassifierLogRow[]) {
  const outcomes = new Map(rows.filter((r) => r.event === "outcome").map((r) => [r.id, r.outcome]));
  const decisions = [...new Set(rows.filter((r) => r.event === "decision").map((r) => r.decision))];
  return decisions.map((decision) => {
    const calls = rows.filter((r) => r.event === "decision" && r.decision === decision);
    const pairs = calls
      .filter((r) => ["shadow", "accepted", "below-threshold"].includes(r.reason ?? ""))
      .flatMap((r) => {
        const agreement = comparable(decision, r.answer, outcomes.get(r.id) ?? r.outcome);
        return agreement === null ? [] : [{ confidence: r.confidence ?? 0, agreement }];
      });
    const usageRows = rows.filter(
      (r) => (r.event === "decision" || r.event === "late-usage") && r.decision === decision && r.usage,
    );
    const models = [...new Set(usageRows.map((r) => r.model ?? "unknown"))].map((model) => {
      const group = usageRows.filter((r) => (r.model ?? "unknown") === model);
      return {
        model,
        billing: group[0]?.billing ?? "unknown",
        freshInput: group.reduce((n, r) => n + (r.usage?.input ?? 0), 0),
        output: group.reduce((n, r) => n + (r.usage?.output ?? 0), 0),
        cacheRead: group.reduce((n, r) => n + (r.usage?.cacheRead ?? 0), 0),
        cacheWrite: group.reduce((n, r) => n + (r.usage?.cacheWrite ?? 0), 0),
        catalogCostEstimateUsd: group.reduce((n, r) => n + (r.usage?.cost.total ?? 0), 0),
      };
    });
    const latencies = calls.map((r) => r.latencyMs ?? 0).sort((a, b) => a - b);
    return {
      decision,
      calls: calls.length,
      applied: calls.filter((r) => r.source === "classifier").length,
      fallbackReasons: Object.fromEntries(
        [...new Set(calls.map((r) => r.reason ?? "unknown"))].map((reason) => [
          reason,
          calls.filter((r) => r.reason === reason).length,
        ]),
      ),
      paired: pairs.length,
      agreement: pairs.length ? pairs.filter((r) => r.agreement).length / pairs.length : null,
      calibration: [0, 0.5, 0.6, 0.7, 0.85, 0.95].map((lower, i, edges) => {
        const bin = pairs.filter((p) => p.confidence >= lower && p.confidence < (edges[i + 1] ?? 1.01));
        return {
          lower,
          n: bin.length,
          agreement: bin.length ? bin.filter((p) => p.agreement).length / bin.length : null,
        };
      }),
      latencyMs: {
        median: latencies[Math.floor(latencies.length / 2)] ?? null,
        p95: latencies[Math.max(0, Math.ceil(latencies.length * 0.95) - 1)] ?? null,
      },
      models,
    };
  });
}
