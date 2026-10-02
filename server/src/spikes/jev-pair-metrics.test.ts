import { expect, it } from "vitest";
import { escalatesAt, type PairRow, summarizePairs } from "./jev-pair-metrics.js";

function row(id: string, claims: boolean, usageTokens: number, confidence = 0.99): PairRow {
  return {
    id,
    kind: "section",
    baseline: {
      batchId: "chapter",
      verdict: "claims",
      usage: { input: usageTokens, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0.1 },
    },
    jev: {
      stopReason: "stop",
      verdict: claims ? "claims" : "no-claims",
      confidence,
      answers: { claims: { type: "bool", probability: claims ? confidence : 1 - confidence } },
      usage: {
        input: 10,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 10,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      ms: 10,
    },
    agreement: claims,
  };
}
it("only saves shared chapter usage when every section bypasses", () => {
  const result = summarizePairs([row("a", false, 100), row("b", true, 0)], "section");
  expect(result.selected?.savedLlmTokens).toBe(0);
  expect(result.selected?.pipelineTokens).toBe(120);
  expect(result.selected?.autoDisagreements).toBe(1);
  expect(summarizePairs([row("a", false, 100), row("b", false, 0)], "section").selected?.savedLlmTokens).toBe(100);
});
it("reports uncertainty for tiny auto-accept samples and disables bypass above one", () => {
  const safe = row("a", false, 100);
  safe.agreement = true;
  safe.baseline.verdict = "no-claims";
  const result = summarizePairs([safe], "section");
  expect(result.selected?.autoErrorWilson95Upper).toBeGreaterThan(0.7);
  expect(escalatesAt(safe, 1.01)).toBe(true);
});
it("keeps missing classifier usage unknown and errors escalated", () => {
  const sample = row("a", false, 100);
  if (sample.jev) sample.jev.usage = null;
  expect(summarizePairs([sample], "section").selected?.pipelineTokens).toBeNull();
  if (sample.jev) sample.jev.stopReason = "error";
  expect(escalatesAt(sample, 0.85)).toBe(true);
});
