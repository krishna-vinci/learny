import type { Dirent } from "node:fs";
import { promises as fs } from "node:fs";
import type { CommitInfo } from "@studium/shared";
import { Hono } from "hono";
import { listCardFiles } from "../cards/store.js";
import { readInbox } from "../inbox/read.js";
import type { JobRunner } from "../jobs/runner.js";
import { PracticeStore } from "../practice/store.js";
import { buildToday } from "../today/build.js";
import { log } from "../tree/git.js";
import { FileLocks } from "../tree/lock.js";
import { resolveInRoot } from "../tree/paths.js";
import { listNotes, listSets } from "../tree/read.js";

export interface TodayRoutesDeps {
  root: string;
  jobs?: JobRunner;
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
  return Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl"))
      .map(async (entry) => {
        const stat = await fs.stat(resolveInRoot(root, `${set}/chats/${entry.name}`));
        return stat.mtime.toISOString();
      }),
  );
}

async function setCommits(root: string, set: string): Promise<CommitInfo[]> {
  try {
    // Only the newest user commit matters; filtering by author in git keeps this O(1) in history size.
    return await log(root, { path: `${set}/`, limit: 1, author: "user" });
  } catch {
    // A new study tree may not have any git history yet.
    return [];
  }
}

export function todayRoutes(deps: TodayRoutesDeps): Hono {
  const app = new Hono();
  app.get("/", async (c) => {
    const sets = await listSets(deps.root);
    const snapshots = await Promise.all(
      sets.map(async (set) => {
        // Existing listings use direct filesystem paths; confine them before returning data.
        resolveInRoot(deps.root, `${set.slug}/PLAN.md`);
        resolveInRoot(deps.root, `${set.slug}/notes`);
        const [inbox, cardFiles, notes, commits, chats, curriculum, weakSpots] = await Promise.all([
          readInbox(deps.root, set.slug),
          listCardFiles(deps.root, set.slug),
          listNotes(deps.root, set.slug),
          setCommits(deps.root, set.slug),
          chatActivity(deps.root, set.slug),
          readCurriculum(deps.root, set.slug),
          new PracticeStore({ root: deps.root, locks: new FileLocks() }, set.slug).readWeakSpots(),
        ]);
        return {
          ...set,
          inbox,
          cardFiles,
          notesCount: notes.length,
          notePaths: notes.map((note) => note.path),
          jobs: deps.jobs?.list(set.slug) ?? [],
          commits,
          chatActivity: chats,
          curriculum,
          weakSpots,
        };
      }),
    );
    return c.json(buildToday(snapshots, new Date()));
  });
  return app;
}
