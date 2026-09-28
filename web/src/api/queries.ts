import type { FileView, NoteSummary, SetSummary } from "@studium/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { useStudiumEvents } from "./events";

export const queryKeys = {
  sets: ["sets"] as const,
  notes: (set: string) => ["sets", set, "notes"] as const,
  file: (set: string, path: string) => ["sets", set, "file", path] as const,
  history: (set: string, path?: string) => ["sets", set, "history", path ?? null] as const,
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

/**
 * Wires SSE `file`/`commit` events into React Query cache invalidation, so notes,
 * file content, and history stay live without polling.
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
    }
  });
}
