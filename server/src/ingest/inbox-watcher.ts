import { promises as fs, mkdirSync } from "node:fs";
import path from "node:path";
import { watch } from "chokidar";
import type { JobRunner } from "../jobs/runner.js";
import { resolveInRoot } from "../tree/paths.js";
import type { IngestJobInput } from "./library.js";

/** Drop folder (study-root relative) for files handed to the ingest pipeline. */
export const INBOX_DIR = "library/_inbox";

export interface InboxWatcherDeps {
  root: string;
  jobs: JobRunner;
}

/**
 * Watch `library/_inbox/` for dropped files. Each stable file is read into
 * memory and enqueued as a set-less `ingest` job, then removed so it is not
 * ingested twice. `awaitWriteFinish` keeps partially-written uploads from
 * being picked up (decision: folder entry point).
 */
export function startInboxWatcher(deps: InboxWatcherDeps): () => Promise<void> {
  const inboxAbs = resolveInRoot(deps.root, INBOX_DIR);
  mkdirSync(inboxAbs, { recursive: true });
  const picked = new Set<string>();

  const watcher = watch(inboxAbs, {
    ignoreInitial: false, // pick up files left over from before a restart; ingest dedupes by sha256
    depth: 0,
    awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 50 },
  });

  const handle = (target: string): void => {
    const abs = path.resolve(target);
    if (path.dirname(abs) !== path.resolve(inboxAbs)) return;
    if (picked.has(abs)) return;
    picked.add(abs);
    void pickUp(abs).finally(() => picked.delete(abs));
  };

  async function pickUp(abs: string): Promise<void> {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await fs.readFile(abs));
    } catch {
      return; // Raced with a delete/move; nothing to ingest.
    }
    const filename = path.basename(abs);
    if (bytes.length === 0) {
      await fs.unlink(abs).catch(() => undefined);
      return;
    }
    // The file stays in _inbox until the ingest job succeeds (it deletes it) or fails (moves it to _inbox/failed/),
    // so a failed job or a restart never loses the learner's file.
    const input: IngestJobInput = { filename, bytes, set: null, inboxPath: path.relative(deps.root, abs) };
    deps.jobs.enqueue("ingest", input, { set: null, title: filename });
  }

  watcher.on("add", handle);
  watcher.on("change", handle);

  return async () => {
    await watcher.close();
  };
}
