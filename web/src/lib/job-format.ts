// T9b: shared formatting for job usage/cost/duration, used by JobsPage, InboxPage and the
// chat dock's job-proposal card so the numbers read the same everywhere.

/** `12345` -> `"12.3k"`, `900` -> `"900"`. */
export function formatTokenCount(count: number): string {
  if (count < 1000) return String(Math.round(count));
  const thousands = count / 1000;
  const rounded = Math.round(thousands * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}k`;
}

/** `{ input: 12345, output: 2100, ... }` -> `"12.3k in · 2.1k out"`. */
export function formatTokenUsage(usage: { input: number; output: number }): string {
  return `${formatTokenCount(usage.input)} in · ${formatTokenCount(usage.output)} out`;
}

/** `0` -> `"subscription"` (flat-rate model), else `"$0.04"`. */
export function formatCost(costUsd: number | null): string {
  if (costUsd === null || costUsd === 0) return "subscription";
  return `$${costUsd.toFixed(2)}`;
}

/** `≈12k tokens · subscription` / `≈12k tokens · ~$0.04`, for the chat job-proposal card. */
export function formatEstimate(estimate: { tokens: number; costUsd: number | null }): string {
  const cost =
    estimate.costUsd === null || estimate.costUsd === 0 ? "subscription" : `~$${estimate.costUsd.toFixed(2)}`;
  return `≈${formatTokenCount(estimate.tokens)} tokens · ${cost}`;
}

/** `startedAt`/`finishedAt` (ISO or null) -> `"2m 14s"` / `"45s"` / `"—"`. */
export function formatDuration(startedAt: string | null, finishedAt: string | null): string {
  if (!startedAt) return "—";
  const start = new Date(startedAt).getTime();
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return "—";
  const totalSeconds = Math.round((end - start) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
}
