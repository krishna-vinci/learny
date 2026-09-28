import { promises as fs } from "node:fs";
import path from "node:path";
import type { JobView } from "@studium/shared";
import { resolveInRoot } from "../tree/paths.js";

// `12.3k in / 2.1k out`: thousands compressed to one decimal, smaller values plain.
function formatTokens(count: number): string {
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

function formatTimestamp(iso: string | null): string {
  // Minute precision keeps the log readable; `slice` avoids a locale-dependent format.
  return iso === null ? "" : `${iso.slice(0, 16)}Z`;
}

function sanitizeTitle(title: string): string {
  return title
    .replace(/[\r\n]+/g, " ")
    .replace(/"/g, "'")
    .trim();
}

/**
 * One line per finished job, e.g.
 * `- 2026-09-29T10:00Z · draft-chapter · "Title" · done · 12.3k in / 2.1k out · $0.04 · commit abc1234`.
 */
export function formatJobLogLine(job: JobView): string {
  const parts = [
    `- ${formatTimestamp(job.finishedAt ?? job.startedAt)}`,
    job.kind,
    `"${sanitizeTitle(job.title)}"`,
    job.status,
    `${formatTokens(job.usage.input)} in / ${formatTokens(job.usage.output)} out`,
    `$${job.usage.costUsd.toFixed(2)}`,
  ];
  if (job.result?.commitSha !== undefined) {
    parts.push(`commit ${job.result.commitSha.slice(0, 7)}`);
  }
  return parts.join(" · ");
}

export function jobLogPath(job: JobView): string {
  // Set-less jobs (ingest without a target set) log to the library instead.
  return job.set === null ? "library/_jobs.md" : `${job.set}/log/jobs.md`;
}

export async function appendJobLog(root: string, job: JobView): Promise<string> {
  const rel = jobLogPath(job);
  const abs = resolveInRoot(root, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.appendFile(abs, `${formatJobLogLine(job)}\n`, "utf8");
  return rel;
}
