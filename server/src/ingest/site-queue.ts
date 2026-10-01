// The "import a documentation site" queue: at most three ingest jobs outstanding per workspace, the
// rest wait here. The waiting and in-flight URLs are persisted (`<root>/.cache/site-import-queue.json`)
// so a restart resumes the import instead of silently dropping it.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { EventHub } from "../events.js";
import type { JobRunner } from "../jobs/runner.js";
import { AiDisabledError } from "../jobs/runner.js";
import { dedupeKeyFromUrl } from "./ids.js";
import { findDuplicate, type IngestJobInput } from "./library.js";

export interface SiteImportItem {
  url: string;
  set: string | null;
}

export interface SiteImportQueueDeps {
  root: string;
  hub: EventHub;
  jobs: Pick<JobRunner, "enqueue">;
  /** JSON file for persistence; omit for an in-memory queue (tests). */
  file?: string;
  maxConcurrent?: number;
}

export function jobTitleFor(url: string): string {
  try {
    const parsed = new URL(url);
    const last = parsed.pathname
      .split("/")
      .filter((part) => part !== "")
      .pop();
    return last === undefined ? parsed.hostname : decodeURIComponent(last);
  } catch {
    return url;
  }
}

export function defaultSiteQueueFile(root: string): string {
  return path.join(root, ".cache", "site-import-queue.json");
}

export class SiteImportQueue {
  readonly #deps: SiteImportQueueDeps;
  readonly #max: number;
  readonly #waiting: SiteImportItem[] = [];
  readonly #active = new Map<string, SiteImportItem>();
  #unsubscribe: (() => void) | null = null;

  constructor(deps: SiteImportQueueDeps) {
    this.#deps = deps;
    this.#max = deps.maxConcurrent ?? 3;
  }

  /** URLs still to import (waiting or being ingested). */
  get pending(): number {
    return this.#waiting.length + this.#active.size;
  }

  enqueue(urls: string[], set: string | null): void {
    if (urls.length === 0) return;
    for (const url of urls) this.#waiting.push({ url, set });
    this.#pump();
  }

  /**
   * Re-queue what a previous run left unfinished. Jobs that were in flight are lost with the process,
   * so their URLs come back too, unless the page is already in the library.
   */
  async resume(): Promise<number> {
    const file = this.#deps.file;
    if (file === undefined) return 0;
    let saved: SiteImportItem[] = [];
    try {
      const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
      if (Array.isArray(parsed)) {
        saved = parsed.filter(
          (entry): entry is SiteImportItem =>
            typeof entry === "object" &&
            entry !== null &&
            typeof (entry as SiteImportItem).url === "string" &&
            ((entry as SiteImportItem).set === null || typeof (entry as SiteImportItem).set === "string"),
        );
      }
    } catch {
      return 0;
    }
    let resumed = 0;
    for (const item of saved) {
      if ((await findDuplicate(this.#deps.root, dedupeKeyFromUrl(item.url))) !== null) continue;
      this.#waiting.push(item);
      resumed += 1;
    }
    this.#pump();
    if (resumed === 0) this.#save();
    return resumed;
  }

  dispose(): void {
    this.#unsubscribe?.();
    this.#unsubscribe = null;
  }

  #pump(): void {
    if (this.pending > 0 && this.#unsubscribe === null) {
      // A running cancellation releases its slot only after the handler exits (finishedAt is set).
      this.#unsubscribe = this.#deps.hub.subscribe((event) => {
        if (event.type !== "job" || event.job.finishedAt === null || !this.#active.delete(event.job.id)) return;
        this.#pump();
      });
    }
    while (this.#active.size < this.#max) {
      const item = this.#waiting.shift();
      if (item === undefined) break;
      const input: IngestJobInput = { url: item.url, set: item.set };
      try {
        const job = this.#deps.jobs.enqueue("ingest", input, { set: item.set, title: jobTitleFor(item.url) });
        this.#active.set(job.id, item);
      } catch (error) {
        if (!(error instanceof AiDisabledError)) throw error;
        // AI was turned off for this account while pages waited: drop the rest of the import.
        console.warn(`studium: AI disabled, dropping ${this.#waiting.length + 1} queued site import page(s)`);
        this.#waiting.length = 0;
        break;
      }
    }
    this.#save();
    if (this.pending === 0) this.dispose(); // idle: stop listening until the next import
  }

  #save(): void {
    const file = this.#deps.file;
    if (file === undefined) return;
    try {
      const remaining = [...this.#active.values(), ...this.#waiting];
      if (remaining.length === 0) {
        rmSync(file, { force: true });
        return;
      }
      mkdirSync(path.dirname(file), { recursive: true });
      const temp = `${file}.tmp-${process.pid}`;
      writeFileSync(temp, JSON.stringify(remaining));
      renameSync(temp, file);
    } catch (error) {
      console.warn("studium: could not persist the site import queue", error);
    }
  }
}
