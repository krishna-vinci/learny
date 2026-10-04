import { appendCacheLog, readCacheLog } from "../agent/cache-log.js";
export type DomainOutcome = "cited-checked" | "blocked" | "low-quality";
export async function recordDomainOutcome(root: string, raw: string, outcome: DomainOutcome): Promise<void> {
  try {
    await appendCacheLog(root, "source-domains.jsonl", {
      domain: new URL(raw).hostname.toLowerCase().replace(/^www\./, ""),
      outcome,
      at: new Date().toISOString(),
    });
  } catch {
    /* Invalid user metadata is not telemetry. */
  }
}
export async function domainPreferences(root: string): Promise<Map<string, number>> {
  const preferences = new Map<string, number>();
  try {
    const lines = await readCacheLog(root, "source-domains.jsonl");
    for (const line of lines) {
      try {
        const row = JSON.parse(line);
        if (typeof row.domain !== "string") continue;
        const effect =
          row.outcome === "cited-checked" ? 0.2 : row.outcome === "blocked" || row.outcome === "low-quality" ? -0.3 : 0;
        preferences.set(row.domain, Math.max(-1, Math.min(1, (preferences.get(row.domain) ?? 0) + effect)));
      } catch {
        /* Partial/corrupt cache rows are disposable. */
      }
    }
  } catch {
    /* No cache yet. */
  }
  return preferences;
}
