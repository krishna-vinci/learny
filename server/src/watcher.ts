import path from "node:path";
import type { StudiumEvent } from "@studium/shared";
import { watch } from "chokidar";
import type { EventHub } from "./events.js";
import { isSetSlug } from "./tree/read.js";

// chokidar v4+ dropped glob support, so the ignores are matched by path segment.
// `_inbox` is handled by its own watcher, so the shared SSE watcher skips it
// (and never publishes partially-written drops).
const IGNORED_SEGMENTS = new Set([".git", ".cache", "chats", "_inbox"]);

function relativePosix(root: string, target: string): string | null {
  const rel = path.relative(root, path.resolve(target));
  if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return rel.split(path.sep).join("/");
}

export function startWatcher(root: string, hub: EventHub): () => Promise<void> {
  const watcher = watch(root, {
    ignoreInitial: true,
    ignored: (target: string) => {
      const rel = relativePosix(root, target);
      if (rel === null) return false;
      return rel.split("/").some((segment) => IGNORED_SEGMENTS.has(segment));
    },
    awaitWriteFinish: { stabilityThreshold: 150 },
  });

  const publish = (change: "add" | "change" | "unlink") => (target: string) => {
    const rel = relativePosix(root, target);
    if (rel === null) return;
    const set = rel.split("/")[0] ?? "";
    const event: StudiumEvent = { type: "file", set: isSetSlug(set) ? set : null, path: rel, change };
    hub.publish(event);
  };

  watcher.on("add", publish("add"));
  watcher.on("change", publish("change"));
  watcher.on("unlink", publish("unlink"));

  return async () => {
    await watcher.close();
  };
}
