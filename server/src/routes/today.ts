import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import type { CommitInfo, JobStatus } from "@studium/shared";
import { Hono } from "hono";
import { listCardFiles } from "../cards/store.js";
import { mapConcurrent } from "../concurrency.js";
import type { EventHub } from "../events.js";
import { readInbox } from "../inbox/read.js";
import type { JobRunner } from "../jobs/runner.js";
import { PracticeStore } from "../practice/store.js";
import { buildToday, type TodaySetInput } from "../today/build.js";
import { log } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { resolveInRoot } from "../tree/paths.js";
import { listNotes, listSets } from "../tree/read.js";

export interface TodayRoutesDeps {
  root: string;
  jobs?: JobRunner;
  hub?: EventHub;
}

async function readCurriculum(root: string, set: string): Promise<string | null> {
  try {
    return await fs.readFile(resolveInRoot(root, `${set}/curriculum.md`), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
}

async function chatActivity(root: string, set: string): Promise<string[]> {
  const dir = resolveInRoot(root, `${set}/chats`);
  let entries: Dirent[];
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  return mapConcurrent(
    entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl")),
    4,
    async (entry) => {
      const stat = await fs.stat(resolveInRoot(root, `${set}/chats/${entry.name}`));
      return stat.mtime.toISOString();
    },
  );
}

async function setCommits(root: string, set: string): Promise<CommitInfo[]> {
  try {
    // Return one matching commit; Git may still traverse older history to find it.
    return await log(root, { path: `${set}/`, limit: 1, author: "user" });
  } catch {
    // A new study tree may not have any git history yet.
    return [];
  }
}

export function todayRoutes(deps: TodayRoutesDeps): Hono {
  const app = new Hono();
  let cached: TodaySetInput[] | undefined;
  let inFlight: Promise<TodaySetInput[]> | undefined;
  let generation = 0;
  let refreshedGeneration = -1;
  let refreshedAt = 0;
  const statuses = new Map<string, JobStatus>();
  deps.hub?.subscribe((event) => {
    if (event.type === "file" || event.type === "commit") generation++;
    else if (event.type === "job" && statuses.get(event.job.id) !== event.job.status) {
      statuses.set(event.job.id, event.job.status);
      if (statuses.size > 1000) statuses.delete(statuses.keys().next().value as string);
      generation++;
    }
  });
  const refresh = async (): Promise<TodaySetInput[]> => {
    // Dirty requests wait for the coalescing window, so their response is fresh.
    if (cached !== undefined)
      await new Promise((resolve) => setTimeout(resolve, Math.max(0, 2000 - (Date.now() - refreshedAt))));
    const startedGeneration = generation;
    const sets = await listSets(deps.root);
    const snapshots = await mapConcurrent(sets, 2, async (set) => {
      // Existing listings use direct filesystem paths; confine them before returning data.
      resolveInRoot(deps.root, `${set.slug}/PLAN.md`);
      resolveInRoot(deps.root, `${set.slug}/notes`);
      const inbox = await readInbox(deps.root, set.slug);
      const cardFiles = await listCardFiles(deps.root, set.slug);
      const notes = await listNotes(deps.root, set.slug);
      const commits = await setCommits(deps.root, set.slug);
      const chats = await chatActivity(deps.root, set.slug);
      const curriculum = await readCurriculum(deps.root, set.slug);
      const weakSpots = await new PracticeStore({ root: deps.root, locks: new FileLocks() }, set.slug).readWeakSpots();
      const jobs = deps.jobs?.list(set.slug) ?? [];
      for (const job of jobs) if (!statuses.has(job.id)) statuses.set(job.id, job.status);
      return {
        ...set,
        inbox,
        cardFiles,
        notesCount: notes.length,
        notes,
        jobs,
        commits,
        chatActivity: chats,
        curriculum,
        weakSpots,
      };
    });
    cached = snapshots;
    refreshedAt = Date.now();
    refreshedGeneration = startedGeneration;
    return snapshots;
  };
  app.get("/", async (c) => {
    if (inFlight === undefined && (cached === undefined || refreshedGeneration !== generation)) {
      inFlight = refresh().finally(() => {
        inFlight = undefined;
      });
    }
    const snapshots = inFlight === undefined ? (cached as TodaySetInput[]) : await inFlight;
    return c.json(buildToday(snapshots, new Date()));
  });
  return app;
}
