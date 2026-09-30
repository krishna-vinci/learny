// A4: detect live job completions from the SSE stream. The same job id arrives many
// times as progress updates, so the tracker emits each done/failed transition at most
// once per id. Jobs that were already terminal in the startup snapshot never enter an
// event, so they can never produce a completion here.
import type { JobView } from "@studium/shared";

export interface JobCompletion {
  job: JobView;
  status: "done" | "failed";
}

/** Records `job` in `seen` and returns it only on its first terminal done/failed event. */
export function acceptJobCompletion(seen: Set<string>, job: JobView): JobCompletion | null {
  if (job.status !== "done" && job.status !== "failed") return null;
  if (seen.has(job.id)) return null;
  seen.add(job.id);
  return { job, status: job.status };
}

/** A stateful wrapper for event handlers; `seen` is private to the returned function. */
export function createJobTransitionTracker(): (job: JobView) => JobCompletion | null {
  const seen = new Set<string>();
  return (job: JobView) => acceptJobCompletion(seen, job);
}

/** Queued or running — the two statuses the activity UI counts as "in flight". */
export function isActiveJob(job: JobView): boolean {
  return job.status === "queued" || job.status === "running";
}

/** How long a finished job stays in the activity panel when this session did not see
 * it finish; older ones are only on the Jobs page. */
const FINISHED_JOB_WINDOW_MS = 2 * 60 * 60 * 1000;

/** Set when this module (and with it the app) loads: the start of this browser session. */
const SESSION_STARTED_AT = Date.now();

/**
 * Recency filter for the activity panel's finished jobs: keep a job that finished
 * during this browser session, and otherwise one finished in the last two hours.
 * A finished job without a parseable timestamp stays visible — the server stamps
 * completions, so this only guards odd data rather than hiding a fresh failure.
 */
export function isRecentlyFinishedJob(
  job: Pick<JobView, "finishedAt">,
  sessionStartedAt: number = SESSION_STARTED_AT,
  now: number = Date.now(),
): boolean {
  if (job.finishedAt === null) return true;
  const finishedAt = Date.parse(job.finishedAt);
  if (Number.isNaN(finishedAt)) return true;
  return finishedAt >= sessionStartedAt || finishedAt >= now - FINISHED_JOB_WINDOW_MS;
}
