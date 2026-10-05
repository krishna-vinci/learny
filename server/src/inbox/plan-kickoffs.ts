import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { JobView } from "@studium/shared";
import { z } from "zod";
import type { EventHub } from "../events.js";
import { enqueueUrlIngest } from "../ingest/enqueue.js";
import type { JobRunner } from "../jobs/runner.js";
import { readText } from "../tree/edit.js";
import { isSetSlug } from "../tree/read.js";
import { resolveDraftSources } from "./plan-sources.js";
import { SOURCE_ID } from "./plans.js";

const Kickoff = z.object({
  id: z.string(),
  set: z.string().refine(isSetSlug),
  ingestJobIds: z.array(z.string()),
  ingests: z.array(
    z.object({
      url: z
        .string()
        .url()
        .regex(/^https?:\/\//),
      jobId: z.string().nullable(),
      status: z.enum(["pending", "done", "failed", "cancelled"]),
      sourceId: z.string().regex(SOURCE_ID).optional(),
    }),
  ),
  chapters: z.array(z.object({ title: z.string(), brief: z.string() })),
  mediaJobId: z.string().nullable().optional(),
  mediaComplete: z.boolean().optional(),
  createdAt: z.string(),
  error: z.string().optional(),
  finishedAt: z.string().optional(),
});
type PlanKickoff = z.infer<typeof Kickoff>;

type KickoffJobs = Pick<JobRunner, "enqueue"> & Partial<Pick<JobRunner, "get" | "seedHistory">>;
export interface PlanKickoffsDeps {
  root: string;
  hub: EventHub;
  jobs: KickoffJobs;
  file?: string;
}

export function defaultPlanKickoffsFile(root: string): string {
  return path.join(root, ".cache", "plan-kickoffs.json");
}

/** Waits outside the runner, so ingests can use every available runner slot. */
export class PlanKickoffs {
  readonly #deps: PlanKickoffsDeps;
  readonly #records = new Map<string, PlanKickoff>();
  readonly #settling = new Set<string>();
  readonly #unsubscribe: () => void;
  #disposed = false;

  constructor(deps: PlanKickoffsDeps) {
    this.#deps = deps;
    if (deps.file !== undefined) {
      try {
        const saved = z.array(Kickoff).parse(JSON.parse(readFileSync(deps.file, "utf8")));
        for (const record of saved) this.#records.set(record.set, record);
      } catch (error) {
        // A corrupt file must not stop the workspace from loading; the kickoffs are lost, not the set.
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT"))
          console.warn("studium: ignoring unreadable plan kickoffs file", error);
      }
    }
    this.#unsubscribe = deps.hub.subscribe((event) => {
      if (event.type !== "job" || event.job.finishedAt === null) return;
      for (const record of this.#records.values()) {
        if (record.error !== undefined) continue;
        if (record.mediaJobId === event.job.id) {
          if (event.job.status === "done") {
            record.mediaComplete = true;
            this.#save();
            void this.#settle(record);
          } else
            this.#fail(
              record,
              "Chapter media planning failed. Retry the approved plan or draft a chapter to retry its media preflight.",
            );
          continue;
        }
        const ingest = record.ingests.find((item) => item.jobId === event.job.id && item.status === "pending");
        if (ingest === undefined) continue;
        if (event.job.status !== "done" && event.job.status !== "failed" && event.job.status !== "cancelled") continue;
        ingest.status = event.job.status;
        const sourceId = event.job.result?.sourceId;
        if (event.job.status === "done" && sourceId !== undefined && SOURCE_ID.test(sourceId))
          ingest.sourceId = sourceId;
        this.#save();
        void this.#settle(record);
      }
    });
  }

  assertAvailable(set: string): void {
    if (this.#records.has(set) && this.#records.get(set)?.error === undefined)
      throw new Error("This set is still adding sources for its approved plan.");
  }

  start(set: string, urls: string[], chapters: PlanKickoff["chapters"]): string[] {
    this.assertAvailable(set);
    const record: PlanKickoff = {
      id: crypto.randomUUID(),
      set,
      chapters,
      createdAt: new Date().toISOString(),
      ingestJobIds: [],
      ingests: urls.map((url) => ({ url, jobId: null, status: "pending" })),
    };
    this.#records.set(set, record);
    // Persist URLs before jobs are started; boot can recover even if we crash during enqueue.
    this.#save();
    this.#enqueuePending(record);
    if (record.ingests.length === 0) void this.#settle(record);
    return [...record.ingestJobIds];
  }

  /** Runner IDs are not persisted by JobRunner; re-ingest unfinished URLs (the handler dedupes and links). */
  async resume(): Promise<void> {
    for (const record of this.#records.values()) {
      if (record.error !== undefined) {
        this.#exposeFailure(record, false);
        continue;
      }
      this.#enqueuePending(record);
      await this.#settle(record);
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#unsubscribe();
  }

  #enqueuePending(record: PlanKickoff): void {
    try {
      for (const ingest of record.ingests) {
        if (ingest.status !== "pending") continue;
        if (ingest.jobId !== null && this.#deps.jobs.get?.(ingest.jobId) !== undefined) continue;
        ingest.jobId = enqueueUrlIngest(this.#deps.jobs, ingest.url, record.set).id;
        record.ingestJobIds = record.ingests.flatMap((item) => (item.jobId === null ? [] : [item.jobId]));
        this.#save();
      }
    } catch (error) {
      this.#fail(record, error instanceof Error ? error.message : String(error));
    }
  }

  async #settle(record: PlanKickoff): Promise<void> {
    if (
      this.#disposed ||
      record.error !== undefined ||
      record.ingests.some((item) => item.status === "pending") ||
      this.#settling.has(record.id)
    )
      return;
    this.#settling.add(record.id);
    try {
      const plan = await readText(this.#deps.root, `${record.set}/PLAN.md`);
      const successful = record.ingests.flatMap((item) =>
        item.status === "done" && item.sourceId ? [item.sourceId] : [],
      );
      const sources = await resolveDraftSources(this.#deps.root, plan, successful);
      if (this.#disposed) return;
      if (sources.length === 0) {
        this.#fail(
          record,
          "Couldn't add any of the plan's sources. Add a source in the Library, then draft the chapters.",
        );
        return;
      }
      if (!record.mediaComplete) {
        if (!record.mediaJobId || this.#deps.jobs.get?.(record.mediaJobId) === undefined) {
          record.mediaJobId = this.#deps.jobs.enqueue(
            "plan-set",
            { set: record.set, mediaOnly: true, sources },
            { set: record.set, title: "Plan chapter media" },
          ).id;
          this.#save();
        }
        return;
      }
      for (const chapter of record.chapters) {
        this.#deps.jobs.enqueue(
          "draft-chapter",
          { set: record.set, ...chapter, sources },
          { set: record.set, title: chapter.title },
        );
      }
      this.#records.delete(record.set);
      this.#save();
    } catch (error) {
      if (!this.#disposed) this.#fail(record, error instanceof Error ? error.message : String(error));
    } finally {
      this.#settling.delete(record.id);
    }
  }

  #fail(record: PlanKickoff, error: string): void {
    record.error = error;
    record.finishedAt = new Date().toISOString();
    this.#save();
    this.#exposeFailure(record, true);
  }

  #exposeFailure(record: PlanKickoff, publish: boolean): void {
    // Reuse the existing plan Activity kind for a failure trace; no runner slot or model call.
    const job: JobView = {
      id: `plan-kickoff:${record.id}`,
      kind: "plan-set",
      set: record.set,
      title: "Add sources for approved plan",
      status: "failed",
      progress: "",
      startedAt: record.createdAt,
      finishedAt: record.finishedAt ?? record.createdAt,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 },
      billing: "metered",
      error: record.error,
    };
    this.#deps.jobs.seedHistory?.([job]);
    if (publish) this.#deps.hub.publish({ type: "job", job });
  }

  #save(): void {
    const file = this.#deps.file;
    if (file === undefined) return;
    if (this.#records.size === 0) {
      rmSync(file, { force: true });
      return;
    }
    mkdirSync(path.dirname(file), { recursive: true });
    const temp = `${file}.tmp-${process.pid}`;
    writeFileSync(temp, JSON.stringify([...this.#records.values()]));
    renameSync(temp, file);
  }
}
