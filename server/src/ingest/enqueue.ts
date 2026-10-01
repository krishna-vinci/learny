import type { JobRunner } from "../jobs/runner.js";
import type { IngestJobInput } from "./library.js";
import { jobTitleFor } from "./site-queue.js";

/** Shared URL ingest entry point for Library adds and approved plans. */
export function enqueueUrlIngest(jobs: Pick<JobRunner, "enqueue">, url: string, set: string | null) {
  const input: IngestJobInput = { url, set };
  return jobs.enqueue("ingest", input, { set, title: jobTitleFor(url) });
}
