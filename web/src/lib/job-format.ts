// T9b: shared formatting for job usage/cost/duration, used by JobsPage, InboxPage and the
// chat dock's job-proposal card so the numbers read the same everywhere.
import type { JobBilling } from "@studium/shared";

/** `12345` -> `"12.3k"`, `900` -> `"900"`. */
export function formatTokenCount(count: number): string {
  if (count < 1000) return String(Math.round(count));
  const thousands = count / 1000;
  const rounded = Math.round(thousands * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}k`;
}

/** `{ input: 12345, output: 2100, ... }` -> `"12.3k in · 2.1k out"`. */
export function formatTokenUsage(usage: {
  input: number;
  output: number;
  exaRequests?: number;
  exaCostUsd?: number;
}): string {
  return `${formatTokenCount(usage.input)} in · ${formatTokenCount(usage.output)} out${usage.exaRequests ? ` · Exa ${usage.exaRequests} requests / $${(usage.exaCostUsd ?? 0).toFixed(3)}` : ""}`;
}

/**
 * How a job's cost reads depends on how it's billed: a flat-rate `"subscription"` job has
 * no dollar amount, `"metered"` shows the list-price cost, and `"mixed"` (subscription
 * quota exhausted partway through) shows both.
 * `formatCost(0.04, "metered")` -> `"$0.04"`, `formatCost(0.04, "mixed")` -> `"~$0.04 +
 * subscription"`, `formatCost(null, "subscription")` -> `"subscription"`.
 */
export function formatCost(costUsd: number | null, billing: JobBilling): string {
  if (billing === "subscription") return "subscription";
  const amount = costUsd === null ? 0 : costUsd;
  if (billing === "mixed") return `~$${amount.toFixed(2)} + subscription`;
  return `$${amount.toFixed(2)}`;
}

/** `≈12k tokens · subscription` / `≈12k tokens · ~$0.04` / `≈12k tokens · ~$0.04 +
 * subscription`, for the chat job-proposal card. `billing` is optional because older
 * `job_proposal` events may not carry it — treated as `"metered"` for the dollar figure,
 * matching the previous behavior for non-zero estimates. */
export function formatEstimate(estimate: { tokens: number; costUsd: number | null; billing?: JobBilling }): string {
  const billing =
    estimate.billing ?? (estimate.costUsd === null || estimate.costUsd === 0 ? "subscription" : "metered");
  const cost =
    billing === "subscription"
      ? "subscription"
      : billing === "mixed"
        ? `~$${(estimate.costUsd ?? 0).toFixed(2)} + subscription`
        : `~$${(estimate.costUsd ?? 0).toFixed(2)}`;
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
