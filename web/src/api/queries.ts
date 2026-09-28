import type { FileView, JobView, NoteSummary, SetSummary, SourceSummary } from "@studium/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, type LibrarySourceView } from "./client";
import { useStudiumEvents } from "./events";

export const queryKeys = {
  sets: ["sets"] as const,
  notes: (set: string) => ["sets", set, "notes"] as const,
  file: (set: string, path: string) => ["sets", set, "file", path] as const,
  history: (set: string, path?: string) => ["sets", set, "history", path ?? null] as const,
  library: ["library"] as const,
  librarySource: (id: string) => ["library", id] as const,
  jobs: (set?: string) => ["jobs", set ?? null] as const,
};

export function useSets() {
  return useQuery<SetSummary[]>({ queryKey: queryKeys.sets, queryFn: () => api.sets.list() });
}

export function useNotes(set: string | undefined) {
  return useQuery<NoteSummary[]>({
    queryKey: queryKeys.notes(set ?? ""),
    queryFn: () => api.sets.notes(set as string),
    enabled: !!set,
  });
}

export function useNoteFile(set: string | undefined, path: string | undefined) {
  return useQuery<FileView>({
    queryKey: queryKeys.file(set ?? "", path ?? ""),
    queryFn: () => api.sets.file(set as string, path as string),
    enabled: !!set && !!path,
  });
}

export function useLibrary() {
  return useQuery<SourceSummary[]>({ queryKey: queryKeys.library, queryFn: () => api.library.list() });
}

export function useLibrarySource(id: string | undefined) {
  return useQuery<LibrarySourceView>({
    queryKey: queryKeys.librarySource(id ?? ""),
    queryFn: () => api.library.get(id as string),
    enabled: !!id,
  });
}

export function useJobs(set?: string) {
  return useQuery<JobView[]>({ queryKey: queryKeys.jobs(set), queryFn: () => api.jobs.list(set) });
}

/**
 * Wires SSE `file`/`commit`/`job` events into React Query cache invalidation, so notes,
 * file content, history, and the library stay live without polling.
 */
export function useLiveStudiumUpdates() {
  const queryClient = useQueryClient();

  useStudiumEvents((event) => {
    if (event.type === "file") {
      if (event.set) {
        queryClient.invalidateQueries({ queryKey: ["sets", event.set, "notes"] });
        queryClient.invalidateQueries({ queryKey: ["sets", event.set, "file"] });
        queryClient.invalidateQueries({ queryKey: ["sets", event.set, "history"] });
      }
      return;
    }
    if (event.type === "commit") {
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey.includes("history") });
      return;
    }
    if (event.type === "job") {
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === "jobs" });
      // Ingest jobs write new library entries (or update the pending one); refresh the
      // list and, once we know the source id, its detail page too.
      if (event.job.kind === "ingest" && event.job.status !== "queued" && event.job.status !== "running") {
        queryClient.invalidateQueries({ queryKey: queryKeys.library });
        const sourceId = event.job.result?.sourceId;
        if (sourceId) queryClient.invalidateQueries({ queryKey: queryKeys.librarySource(sourceId) });
      }
    }
  });
}
