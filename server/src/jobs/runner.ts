import { randomUUID } from "node:crypto";
import type { JobBilling, JobKind, JobResult, JobStatus, JobUsage, JobView } from "@studium/shared";
import type { EventHub } from "../events.js";
import { appendJobLog } from "./log.js";

// Re-exported so job handlers can import the kind union alongside the runner.
export type { JobKind };

export interface JobContext {
  signal: AbortSignal;
  progress(text: string): void;
  addUsage(u: Partial<JobUsage>): void;
  /** Replace the job's display title once a better one is known (e.g. extracted). */
  setTitle?(title: string): void;
  /** Record a provider id whose model this job used, for billing classification. */
  useProvider?(provider: string): void;
}

export type JobHandler = (input: unknown, ctx: JobContext) => Promise<JobResult | undefined>;

export interface JobRunnerDeps {
  root: string;
  hub: EventHub;
  maxParallel: number;
  /** Provider ids (model-string prefixes) covered by the learner's subscription. */
  subscriptionProviders?: readonly string[];
}

/** Classify a job's billing from the providers it used and the subscription list. */
export function classifyBilling(providers: Iterable<string>, subscription: readonly string[]): JobBilling {
  const subscribed = new Set(subscription);
  const used = new Set(providers);
  if (used.size === 0) return "metered";
  let covered = 0;
  for (const provider of used) if (subscribed.has(provider)) covered += 1;
  if (covered === 0) return "metered";
  return covered === used.size ? "subscription" : "mixed";
}

// `list()` always includes running jobs and at most this many recent ones.
const LIST_LIMIT = 50;
// Finished jobs kept in memory; the oldest are dropped once the cap is exceeded.
export const FINISHED_JOB_LIMIT = 200;

function isFinished(status: JobStatus): boolean {
  return status === "done" || status === "failed" || status === "cancelled";
}

interface JobRecord {
  id: string;
  kind: JobKind;
  set: string | null;
  title: string;
  status: JobStatus;
  progress: string;
  startedAt: string | null;
  finishedAt: string | null;
  usage: JobUsage;
  result?: JobResult;
  error?: string;
  input: unknown;
  createdAt: number;
  controller: AbortController;
  providers: Set<string>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function finite(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function emptyUsage(): JobUsage {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costUsd: 0 };
}

function addUsage(target: JobUsage, patch: Partial<JobUsage>): void {
  target.input += finite(patch.input);
  target.output += finite(patch.output);
  target.cacheRead += finite(patch.cacheRead);
  target.cacheWrite += finite(patch.cacheWrite);
  target.costUsd += finite(patch.costUsd);
}

/** Sum Pi assistant-message usage across a run's messages (tool results excluded). */
export function usageFromPiMessages(messages: unknown[]): JobUsage {
  const usage = emptyUsage();
  for (const message of messages) {
    if (!isRecord(message) || message.role !== "assistant") continue;
    const raw = message.usage;
    if (!isRecord(raw)) continue;
    const cost = isRecord(raw.cost) ? raw.cost : {};
    addUsage(usage, {
      input: finite(raw.input),
      output: finite(raw.output),
      cacheRead: finite(raw.cacheRead),
      cacheWrite: finite(raw.cacheWrite),
      costUsd: finite(cost.total),
    });
  }
  return usage;
}

export class JobRunner {
  readonly #root: string;
  readonly #hub: EventHub;
  readonly #maxParallel: number;
  readonly #subscription: readonly string[];
  readonly #handlers = new Map<JobKind, JobHandler>();
  readonly #jobs = new Map<string, JobRecord>();
  readonly #queue: JobRecord[] = [];
  #running = 0;

  constructor(deps: JobRunnerDeps) {
    this.#root = deps.root;
    this.#hub = deps.hub;
    this.#maxParallel = deps.maxParallel > 0 ? deps.maxParallel : 1;
    this.#subscription = deps.subscriptionProviders ?? [];
  }

  register(kind: JobKind, handler: JobHandler): void {
    this.#handlers.set(kind, handler);
  }

  enqueue(kind: JobKind, input: unknown, meta: { set: string | null; title: string }): JobView {
    const record: JobRecord = {
      id: randomUUID(),
      kind,
      set: meta.set,
      title: meta.title,
      status: "queued",
      progress: "",
      startedAt: null,
      finishedAt: null,
      usage: emptyUsage(),
      input,
      createdAt: Date.now(),
      controller: new AbortController(),
      providers: new Set(),
    };
    this.#jobs.set(record.id, record);
    this.#queue.push(record);
    this.#publish(record);
    // Defer the pump so the caller observes a `queued` snapshot and `queued` is published first.
    queueMicrotask(() => this.#pump());
    return this.#view(record);
  }

  list(set?: string): JobView[] {
    const records = [...this.#jobs.values()]
      .filter((record) => set === undefined || record.set === set)
      .sort((a, b) => b.createdAt - a.createdAt);
    const views = records.map((record) => this.#view(record));
    if (views.length <= LIST_LIMIT) return views;

    const keep = new Set(views.slice(0, LIST_LIMIT).map((view) => view.id));
    for (const view of views) {
      if (view.status === "running") keep.add(view.id);
    }
    return views.filter((view) => keep.has(view.id));
  }

  get(id: string): JobView | undefined {
    const record = this.#jobs.get(id);
    return record === undefined ? undefined : this.#view(record);
  }

  /** Cancel a queued or running job. Returns false when it is unknown or already finished. */
  cancel(id: string): boolean {
    const record = this.#jobs.get(id);
    if (record === undefined) return false;
    if (record.status === "queued") {
      record.status = "cancelled";
      record.finishedAt = new Date().toISOString();
      this.#publish(record);
      this.#pruneFinished();
      return true;
    }
    if (record.status !== "running") return false;
    record.status = "cancelled";
    record.controller.abort();
    this.#publish(record);
    return true;
  }

  /** Drop the oldest finished jobs so memory stays bounded. Map order is insertion order. */
  #pruneFinished(): void {
    const finished = [...this.#jobs.values()].filter((record) => isFinished(record.status));
    for (const record of finished.slice(0, Math.max(0, finished.length - FINISHED_JOB_LIMIT))) {
      this.#jobs.delete(record.id);
    }
  }

  #pump(): void {
    while (this.#running < this.#maxParallel) {
      const next = this.#queue.shift();
      if (next === undefined) return;
      if (next.status !== "queued") continue; // cancelled while waiting
      void this.#run(next);
    }
  }

  async #run(record: JobRecord): Promise<void> {
    this.#running += 1;
    record.status = "running";
    record.startedAt = new Date().toISOString();
    this.#publish(record);

    const ctx: JobContext = {
      signal: record.controller.signal,
      progress: (text) => {
        if (record.status !== "running") return;
        record.progress = text;
        this.#publish(record);
      },
      addUsage: (patch) => {
        if (record.status !== "running") return;
        addUsage(record.usage, patch);
        this.#publish(record);
      },
      setTitle: (title) => {
        if (record.status !== "running") return;
        record.title = title;
        this.#publish(record);
      },
      useProvider: (provider) => {
        if (record.status !== "running") return;
        record.providers.add(provider);
      },
    };

    try {
      const handler = this.#handlers.get(record.kind);
      if (handler === undefined) throw new Error(`no handler registered for job kind "${record.kind}"`);
      const result = await handler(record.input, ctx);
      // Read through a method: `cancel()` may have flipped the status while the handler awaited.
      if (this.#status(record) !== "cancelled") {
        record.status = "done";
        if (result !== undefined) record.result = result;
      }
    } catch (error) {
      if (this.#status(record) === "cancelled" || record.controller.signal.aborted) {
        record.status = "cancelled";
      } else {
        record.status = "failed";
        record.error = error instanceof Error ? error.message : String(error);
      }
    } finally {
      this.#running -= 1;
      if (record.finishedAt === null) record.finishedAt = new Date().toISOString();
      this.#publish(record);
      const view = this.#view(record);
      await appendJobLog(this.#root, view).catch(() => undefined);
      this.#pruneFinished();
      this.#pump();
    }
  }

  #status(record: JobRecord): JobStatus {
    return record.status;
  }

  #view(record: JobRecord): JobView {
    return {
      id: record.id,
      kind: record.kind,
      set: record.set,
      title: record.title,
      status: record.status,
      progress: record.progress,
      startedAt: record.startedAt,
      finishedAt: record.finishedAt,
      usage: { ...record.usage },
      billing: classifyBilling(record.providers, this.#subscription),
      ...(record.result === undefined ? {} : { result: { ...record.result } }),
      ...(record.error === undefined ? {} : { error: record.error }),
    };
  }

  #publish(record: JobRecord): void {
    this.#hub.publish({ type: "job", job: this.#view(record) });
  }
}
