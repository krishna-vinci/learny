import { promises as fs } from "node:fs";
import path from "node:path";
import type { JobKind, JobStatus, JobView } from "@studium/shared";
import { publicErrorReason } from "../ingest/error-reason.js";
import { resolveInRoot } from "../tree/paths.js";
import { listSets } from "../tree/read.js";

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
  if (job.status === "failed" && job.error) parts.push(`reason: ${publicErrorReason(job.error)}`);
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

export type ParsedJobLogLine = Omit<JobView, "id">;

const JOB_LINE =
  /^- (\S+) · (ingest|draft-chapter|rewrite-chapter|make-cards|compile-book|plan-set|make-quiz|make-problems|grade-answer) · "(.*)" · (done|failed|cancelled) · ([0-9]+(?:\.[0-9]+)?k?) in \/ ([0-9]+(?:\.[0-9]+)?k?) out · \$([0-9]+(?:\.[0-9]+)?)(?: · commit ([0-9a-f]+))?(?: · reason: (.*))?$/;

function parseTokens(raw: string): number {
  return Math.round(Number.parseFloat(raw) * (raw.endsWith("k") ? 1000 : 1));
}

export function parseJobLogLine(line: string, set: string | null): ParsedJobLogLine | null {
  const match = JOB_LINE.exec(line.trim());
  if (match === null) return null;
  const [, timestamp, kind, title, status, input, output, cost, commitSha, reason] = match;
  if (
    timestamp === undefined ||
    kind === undefined ||
    title === undefined ||
    status === undefined ||
    input === undefined ||
    output === undefined ||
    cost === undefined ||
    Number.isNaN(Date.parse(timestamp))
  ) {
    return null;
  }

  return {
    kind: kind as JobKind,
    set,
    title,
    status: status as JobStatus,
    progress: "",
    startedAt: null,
    finishedAt: timestamp,
    usage: {
      input: parseTokens(input),
      output: parseTokens(output),
      cacheRead: 0,
      cacheWrite: 0,
      costUsd: Number.parseFloat(cost),
    },
    billing: "metered",
    ...(reason === undefined ? {} : { error: reason }),
    ...(commitSha === undefined ? {} : { result: { commitSha } }),
  };
}

export async function loadJobHistory(root: string, limit = 50): Promise<JobView[]> {
  const sets = await listSets(root);
  const logs: Array<{ owner: string; set: string | null; rel: string }> = sets.map(({ slug }) => ({
    owner: slug,
    set: slug,
    rel: `${slug}/log/jobs.md`,
  }));
  logs.push({ owner: "library", set: null, rel: "library/_jobs.md" });

  const histories = await Promise.all(
    logs.map(async ({ owner, set, rel }) => {
      let text: string;
      try {
        text = await fs.readFile(resolveInRoot(root, rel), "utf8");
      } catch {
        return [];
      }
      return text.split("\n").flatMap((line, index) => {
        const parsed = parseJobLogLine(line, set);
        return parsed === null ? [] : [{ id: `log:${owner}:${index + 1}`, ...parsed }];
      });
    }),
  );

  return histories
    .flat()
    .sort((a, b) => Date.parse(b.finishedAt ?? "") - Date.parse(a.finishedAt ?? ""))
    .slice(0, Math.max(0, Math.floor(limit)));
}
