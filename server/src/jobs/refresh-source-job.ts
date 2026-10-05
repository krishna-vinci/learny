import { publicErrorReason } from "../ingest/error-reason.js";
import { listSetSources } from "../ingest/library.js";
import { type RefreshOptions, refreshSource } from "../ingest/refresh.js";
import { isSetSlug } from "../tree/read.js";
import type { JobHandler } from "./runner.js";

export function createRefreshSourceJob(deps: Omit<RefreshOptions, "signal" | "blockedHosts">): JobHandler {
  return async (input, ctx) => {
    if (!input || typeof input !== "object") throw new Error("Invalid refresh input");
    const value = input as { sourceId?: unknown; set?: unknown };
    const single = typeof value.sourceId === "string" && /^[a-z0-9][a-z0-9-]*$/.test(value.sourceId);
    const set = typeof value.set === "string" && isSetSlug(value.set);
    if (single === set) throw new Error("Supply one sourceId or set");
    const ids = single
      ? [value.sourceId as string]
      : (await listSetSources(deps.root, value.set as string)).map((s) => s.id);
    const refreshes = [];
    const blockedHosts = new Map<string, string>();
    let commitSha: string | undefined;
    for (const [index, id] of ids.entries()) {
      ctx.signal.throwIfAborted();
      ctx.progress(`Refreshing ${index + 1} of ${ids.length}`);
      try {
        const result = await refreshSource({ ...deps, signal: ctx.signal, blockedHosts }, id);
        refreshes.push(result.refresh);
        commitSha = result.commitSha ?? commitSha;
      } catch (error) {
        ctx.signal.throwIfAborted();
        refreshes.push({
          sourceId: id,
          before: 0,
          after: 0,
          status: "skipped" as const,
          disappearedAnchors: [],
          reason: publicErrorReason(error),
        });
      }
    }
    const refreshed = refreshes.filter((r) => r.status === "refreshed").length;
    const skipped = refreshes.filter((r) => r.status === "skipped").length;
    ctx.progress(`${refreshed} refreshed; ${skipped} skipped; ${refreshes.length - refreshed - skipped} unchanged`);
    return {
      refreshes,
      ...(single ? { sourceId: value.sourceId as string } : {}),
      ...(commitSha ? { commitSha } : {}),
      ...(skipped ? { warning: `${skipped} sources skipped; see refresh results for reasons.` } : {}),
    };
  };
}
