import type { FileView, InboxItem, JobView, NoteSummary, SetSummary, SettingsView } from "@studium/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./client";
import { useStudiumEvents } from "./events";

export const queryKeys = {
  sets: ["sets"] as const,
  notes: (set: string) => ["sets", set, "notes"] as const,
  file: (set: string, path: string) => ["sets", set, "file", path] as const,
  history: (set: string, path?: string) => ["sets", set, "history", path ?? null] as const,
  settings: ["settings"] as const,
  // T9b: Jobs panel + Inbox.
  jobs: (set?: string) => ["jobs", set ?? null] as const,
  inbox: (set: string) => ["inbox", set] as const,
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

export function useSettings() {
  return useQuery<SettingsView>({ queryKey: queryKeys.settings, queryFn: () => api.settings.get() });
}

// T9b: Jobs panel query — `set` omitted lists all jobs (running + recent, newest first).
export function useJobs(set?: string) {
  return useQuery<JobView[]>({ queryKey: queryKeys.jobs(set), queryFn: () => api.jobs.list(set) });
}

// T9b: Inbox query — draft/checked chapters for a set.
export function useInbox(set: string | undefined) {
  return useQuery<InboxItem[]>({
    queryKey: queryKeys.inbox(set ?? ""),
    queryFn: () => api.inbox.list(set as string),
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
      return;
    }
    // T9b: keep the Jobs panel live, and refresh a set's Inbox/notes once a
    // draft-chapter job that touched it reaches a terminal state.
    if (event.type === "job") {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      const { job } = event;
      const finished = job.status === "done" || job.status === "failed" || job.status === "cancelled";
      if (job.kind === "draft-chapter" && job.set && finished) {
        queryClient.invalidateQueries({ queryKey: queryKeys.inbox(job.set) });
        queryClient.invalidateQueries({ queryKey: queryKeys.notes(job.set) });
      }
    }
  });
}
