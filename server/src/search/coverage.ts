import { createHash } from "node:crypto";
import { appendCacheLog, readCacheLog } from "../agent/cache-log.js";
import { type Passage, rankPassages } from "./passages.js";
export interface EvidenceCoverage {
  covered: number;
  total: number;
  weakest: string[];
  concepts: string[];
  measuredAt: string;
}
export function chapterConcepts(title: string, scope: string): string[] {
  const concepts = (scope || title)
    .split(/[,;\n]|\band\b/i)
    .map((s) =>
      s
        .replace(/^\s*(?:Scope:|[-*•])\s*/i, "")
        .replace(/[.\s]+$/, "")
        .trim(),
    )
    .filter(Boolean);
  return [...new Set(concepts)].slice(0, 20);
}
/** Lexical section coverage is a scouting signal; the independent checker still verifies every claim. */
export function measureCoverage(concepts: string[], passages: readonly Passage[]): EvidenceCoverage {
  const weakest = concepts.filter((concept) => {
    const terms = [
      ...new Set(
        (concept.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter(
          (t) =>
            !/^(?:the|with|from|for|into|and|how|their|basic|introduction|overview|understanding|including)$/.test(t),
        ),
      ),
    ];
    if (!terms.length) return true;
    const hits = rankPassages(passages, terms.join(" ")).filter((p) => p.score > 0);
    return !hits.some(
      (hit) => terms.filter((term) => hit.text.toLowerCase().includes(term)).length >= Math.min(2, terms.length),
    );
  });
  return {
    concepts,
    covered: concepts.length - weakest.length,
    total: concepts.length,
    weakest,
    measuredAt: new Date().toISOString(),
  };
}
export function coverageKey(set: string, title: string, scope: string): string {
  return createHash("sha256")
    .update(JSON.stringify([set, title, scope]))
    .digest("hex");
}
export async function saveCoverage(
  root: string,
  set: string,
  title: string,
  scope: string,
  coverage: EvidenceCoverage,
): Promise<void> {
  await appendCacheLog(root, "evidence-coverage.jsonl", { key: coverageKey(set, title, scope), coverage });
}
export async function loadCoverage(root: string): Promise<Map<string, EvidenceCoverage>> {
  const result = new Map<string, EvidenceCoverage>();
  try {
    for (const line of await readCacheLog(root, "evidence-coverage.jsonl")) {
      try {
        const row = JSON.parse(line);
        const c = row.coverage;
        if (
          typeof row.key === "string" &&
          Array.isArray(c?.weakest) &&
          c.weakest.every((s: unknown) => typeof s === "string") &&
          Number.isInteger(c.total) &&
          c.total >= 0 &&
          Number.isInteger(c.covered) &&
          c.covered >= 0 &&
          c.covered <= c.total &&
          typeof c.measuredAt === "string"
        )
          result.set(row.key, c);
      } catch {
        /* Rebuildable, optional cache. */
      }
    }
  } catch {
    /* Unknown until first assessment. */
  }
  return result;
}
