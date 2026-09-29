import type {
  CardFileDetail,
  CardFileView,
  FileView,
  InboxItem,
  JobView,
  NoteSummary,
  ParsedFileView,
  SetSummary,
  SettingsView,
  SourceSummary,
} from "@studium/shared";
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
  libraryParsedFile: (id: string, file: string) => ["library", id, "parsed", file] as const,
  settings: ["settings"] as const,
  // T9b: Jobs panel + Inbox.
  jobs: (set?: string) => ["jobs", set ?? null] as const,
  inbox: (set: string) => ["inbox", set] as const,
  // M2 T6: Cards. `cardFile` nests under `cardFiles` so invalidating the list also
  // invalidates every file detail query (React Query matches query keys by prefix).
  cardFiles: (set: string) => ["sets", set, "cards"] as const,
  cardFile: (set: string, path: string) => ["sets", set, "cards", path] as const,
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

// M2 T6: Cards — one entry per `<set>/cards/NN-slug.md`.
export function useCardFiles(set: string | undefined) {
  return useQuery<CardFileView[]>({
    queryKey: queryKeys.cardFiles(set ?? ""),
    queryFn: () => api.cards.list(set as string),
    enabled: !!set,
  });
}

// M2 T6: one card file's cards (review mode).
export function useCardFile(set: string | undefined, path: string | undefined) {
  return useQuery<CardFileDetail>({
    queryKey: queryKeys.cardFile(set ?? "", path ?? ""),
    queryFn: () => api.cards.file(set as string, path as string),
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

export function useLibraryParsedFile(id: string | undefined, file: string | undefined) {
  return useQuery<ParsedFileView>({
    queryKey: queryKeys.libraryParsedFile(id ?? "", file ?? ""),
    queryFn: () => api.library.parsed(id as string, file as string),
    enabled: !!id && !!file,
  });
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
        // A note change can flip a card file's `stale` flag; a card file change (agent or
        // user commit) changes counts/critic verdicts. `cardFiles(set)` also covers every
        // `cardFile(set, path)` query, since the latter's key is the former's plus a path.
        queryClient.invalidateQueries({ queryKey: queryKeys.cardFiles(event.set) });
      }
      return;
    }
    if (event.type === "commit") {
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey.includes("history") });
      // A user commit (card patch, approve-clean, exported) doesn't carry a `set`, so
      // refresh every set's cards rather than trying to guess which one changed.
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "sets" && query.queryKey[2] === "cards",
      });
      return;
    }
    if (event.type === "job") {
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === "jobs" });
      const { job } = event;
      const finished = job.status === "done" || job.status === "failed" || job.status === "cancelled";
      // A finished draft-chapter job changes that set's Inbox and notes.
      if (job.kind === "draft-chapter" && job.set && finished) {
        queryClient.invalidateQueries({ queryKey: queryKeys.inbox(job.set) });
        queryClient.invalidateQueries({ queryKey: queryKeys.notes(job.set) });
      }
      // A finished make-cards job (fresh drafts, or a count:0 re-check) changes the
      // target card file and its counts/stale flag in the cards list.
      if (job.kind === "make-cards" && job.set && finished) {
        queryClient.invalidateQueries({ queryKey: queryKeys.cardFiles(job.set) });
      }
      // Ingest jobs write new library entries (or update the pending one); refresh the
      // list and, once we know the source id, its detail page too.
      if (job.kind === "ingest" && finished) {
        queryClient.invalidateQueries({ queryKey: queryKeys.library });
        const sourceId = job.result?.sourceId;
        if (sourceId) queryClient.invalidateQueries({ queryKey: queryKeys.librarySource(sourceId) });
      }
    }
  });
}
