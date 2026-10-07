import type {
  CardFileDetail,
  CardFileView,
  FileView,
  InboxItem,
  JobView,
  NoteSummary,
  ParsedFileView,
  PlanProposal,
  SetSummary,
  SettingsView,
  SourceSummary,
} from "@studium/shared";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef } from "react";
import type {
  AccessTokenSummary,
  AuthStatus,
  BackupDestination,
  BackupRetention,
  BackupSchedule,
  IdentityProviderInput,
  NotificationsView,
  Session,
  SsoRequest,
  User,
} from "./client";
import { api, type LibrarySourceView } from "./client";
import { useStudiumEvents } from "./events";

export const queryKeys = {
  authStatus: ["auth", "status"] as const,
  me: ["me"] as const,
  meSessions: ["me", "sessions"] as const,
  meAccessTokens: ["me", "accessTokens"] as const,
  meIdentities: ["me", "identities"] as const,
  meNotifications: ["me", "notifications"] as const,
  adminUsers: ["admin", "users"] as const,
  adminInstance: ["admin", "instance"] as const,
  adminIdentityProviders: ["admin", "identityProviders"] as const,
  adminBackups: ["admin", "backups"] as const,
  adminYoutube: ["admin", "youtube"] as const,
  adminBackupStatus: ["admin", "backups", "status"] as const,
  adminBackupSnapshots: ["admin", "backups", "snapshots"] as const,
  today: ["today"] as const,
  search: ["search"] as const,
  highlights: (set: string, note?: string) => ["highlights", set, ...(note ? [note] : [])] as const,
  sets: ["sets"] as const,
  recentlyDeleted: ["recently-deleted"] as const,
  course: (set: string) => ["sets", set, "course"] as const,
  sources: (set: string) => ["sets", set, "sources"] as const,
  notes: (set: string) => ["sets", set, "notes"] as const,
  file: (set: string, path: string) => ["sets", set, "file", path] as const,
  book: (set: string) => ["sets", set, "book"] as const,
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

export function useCourse(set: string) {
  return useQuery({ queryKey: queryKeys.course(set), queryFn: () => api.sets.course(set) });
}

export function useSetSources(set: string | undefined) {
  return useQuery({
    queryKey: queryKeys.sources(set ?? ""),
    queryFn: () => api.sets.sources(set as string),
    enabled: !!set,
  });
}

export function useToday() {
  return useQuery({ queryKey: queryKeys.today, queryFn: () => api.today() });
}

export function useHighlights(set: string, note: string) {
  return useQuery({ queryKey: queryKeys.highlights(set, note), queryFn: () => api.highlights.list(set, note) });
}

// Public: powers the setup/sign-in/AuthGate flows before a session exists.
export function useAuthStatus() {
  return useQuery<AuthStatus>({ queryKey: queryKeys.authStatus, queryFn: () => api.auth.status(), retry: false });
}

/** The signed-in user, or `undefined` while loading/unauthenticated. Used by the sidebar
 * footer and every Settings section that needs the current user. */
export function useCurrentUser() {
  const query = useQuery<{ user: User }>({
    queryKey: queryKeys.me,
    queryFn: () => api.me.get(),
    retry: false,
  });
  return { ...query, user: query.data?.user };
}

export function useUpdateMe() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: { displayName?: string; email?: string; avatarUrl?: string }) => api.me.update(patch),
    onSuccess: (result) => queryClient.setQueryData(queryKeys.me, result),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (body: { currentPassword?: string; newPassword: string }) => api.me.changePassword(body),
  });
}

export function useSessions() {
  return useQuery<{ sessions: Session[] }>({ queryKey: queryKeys.meSessions, queryFn: () => api.me.sessions() });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.me.revokeSession(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.meSessions }),
  });
}

export function useAccessTokens() {
  return useQuery<{ accessTokens: AccessTokenSummary[] }>({
    queryKey: queryKeys.meAccessTokens,
    queryFn: () => api.me.accessTokens(),
  });
}

export function useCreateAccessToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { description: string; expiresInDays?: number }) => api.me.createAccessToken(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.meAccessTokens }),
  });
}

export function useDeleteAccessToken() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.me.deleteAccessToken(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.meAccessTokens }),
  });
}

export function useAdminUsers() {
  return useQuery<{ users: User[] }>({ queryKey: queryKeys.adminUsers, queryFn: () => api.admin.users() });
}

export function useCreateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Parameters<typeof api.admin.createUser>[0]) => api.admin.createUser(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers }),
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Parameters<typeof api.admin.updateUser>[1] }) =>
      api.admin.updateUser(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers }),
  });
}

export function useDeleteUser() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, purge }: { id: number; purge?: boolean }) => api.admin.deleteUser(id, { purge }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminUsers }),
  });
}

export function useAdminInstance() {
  return useQuery({ queryKey: queryKeys.adminInstance, queryFn: () => api.admin.instance() });
}

export function useUpdateAdminInstance() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (patch: { disallowPasswordAuth?: boolean; instanceUrl?: string }) => api.admin.updateInstance(patch),
    // Optimistic for the password-sign-in switch; the URL field keeps its own draft.
    onMutate: async (patch) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.adminInstance });
      const previous = queryClient.getQueryData<{ disallowPasswordAuth: boolean; instanceUrl: string }>(
        queryKeys.adminInstance,
      );
      if (previous) queryClient.setQueryData(queryKeys.adminInstance, { ...previous, ...patch });
      return { previous };
    },
    onError: (_error, _patch, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.adminInstance, context.previous);
    },
    onSuccess: (result) => {
      queryClient.setQueryData(queryKeys.adminInstance, result);
      queryClient.invalidateQueries({ queryKey: queryKeys.authStatus });
    },
  });
}

// --- SSO (slice b) --------------------------------------------------------------------

export function useIdentities() {
  return useQuery({ queryKey: queryKeys.meIdentities, queryFn: () => api.me.identities() });
}

export function useLinkIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: SsoRequest) => api.me.linkIdentity(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.meIdentities }),
  });
}

export function useUnlinkIdentity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (providerId: number) => api.me.unlinkIdentity(providerId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.meIdentities }),
  });
}

export function useAdminIdentityProviders() {
  return useQuery({ queryKey: queryKeys.adminIdentityProviders, queryFn: () => api.admin.identityProviders.list() });
}

export function useCreateIdentityProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: IdentityProviderInput) => api.admin.identityProviders.create(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminIdentityProviders }),
  });
}

export function useUpdateIdentityProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: number; patch: Partial<IdentityProviderInput> }) =>
      api.admin.identityProviders.update(id, patch),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminIdentityProviders }),
  });
}

export function useDeleteIdentityProvider() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.admin.identityProviders.delete(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminIdentityProviders }),
  });
}

// --- Backups (slice c) ------------------------------------------------------------------

export function useAdminBackups() {
  return useQuery({ queryKey: queryKeys.adminBackups, queryFn: () => api.admin.backups.get() });
}

export function useUpdateBackupSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { schedule?: Partial<BackupSchedule>; retention?: Partial<BackupRetention> }) =>
      api.admin.backups.update(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminBackups }),
  });
}

export function useTestBackupDestination() {
  return useMutation({ mutationFn: (destination: BackupDestination) => api.admin.backups.test(destination) });
}

export function useInitBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ destination, existingPassword }: { destination: BackupDestination; existingPassword?: string }) =>
      api.admin.backups.init(destination, existingPassword),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminBackups }),
  });
}

export function useRunBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.admin.backups.run(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminBackupStatus }),
  });
}

/** Polls status while a backup is running (2s interval); idle otherwise. */
export function useBackupStatus() {
  return useQuery({
    queryKey: queryKeys.adminBackupStatus,
    queryFn: () => api.admin.backups.status(),
    refetchInterval: (query) => (query.state.data?.running ? 2000 : false),
  });
}

export function useBackupSnapshots(enabled: boolean) {
  return useQuery({ queryKey: queryKeys.adminBackupSnapshots, queryFn: () => api.admin.backups.snapshots(), enabled });
}

export function useCheckBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => api.admin.backups.check(),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminBackups }),
  });
}

export function useRestoreBackup() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { snapshotId: string; scope: { type: "note" | "set"; username: string; path: string } }) =>
      api.admin.backups.restore(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.sets }),
  });
}

export function useSftpKey() {
  return useMutation({ mutationFn: () => api.admin.backups.sftpKey() });
}

// --- YouTube integration (Settings → Integrations) --------------------------------------

export function useYoutubeStatus() {
  return useQuery({
    queryKey: queryKeys.adminYoutube,
    queryFn: () => api.admin.youtube.status(),
    // Self-heal while Settings is open: stale credentials are resolved by a
    // re-export on the server, with no restart, so poll while stale.
    refetchInterval: (query) => (query.state.data?.cookies.stale ? 10_000 : false),
  });
}

function useYoutubeMutation<TArgs>(mutationFn: (args: TArgs) => Promise<unknown>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.adminYoutube }),
  });
}

export function useInstallYoutubeEngine() {
  return useYoutubeMutation(() => api.admin.youtube.install());
}

export function useUpdateYoutubeEngine() {
  return useYoutubeMutation(() => api.admin.youtube.update());
}

export function useUploadYoutubeCookies() {
  return useYoutubeMutation((file: File) => api.admin.youtube.uploadCookies(file));
}

export function useRemoveYoutubeCookies() {
  return useYoutubeMutation(() => api.admin.youtube.removeCookies());
}

/** Retry the transcript ladder for one blocked source; invalidates its detail + Activity. */
export function useRefreshSources() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (target: { id: string } | { set: string }) =>
      "id" in target ? api.library.refresh(target.id) : api.library.refreshSet(target.set),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
  });
}

export function useRetryTranscript() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.library.retryTranscript(id),
    onSuccess: (_result, id) => {
      queryClient.invalidateQueries({ queryKey: queryKeys.librarySource(id) });
      queryClient.invalidateQueries({ predicate: (query) => query.queryKey[0] === "jobs" });
    },
  });
}

// --- Notifications + export (slice d) ----------------------------------------------------

export function useNotifications() {
  return useQuery<NotificationsView>({
    queryKey: queryKeys.meNotifications,
    queryFn: () => api.me.notifications.get(),
  });
}

export function useUpdateNtfy() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { url: string; token?: string }) => api.me.notifications.putNtfy(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.meNotifications }),
  });
}

export function useSubscribePush() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { endpoint: string; keys: { p256dh: string; auth: string } }) =>
      api.me.notifications.subscribePush(body),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.meNotifications }),
  });
}

export function useDeletePush() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.me.notifications.deletePush(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: queryKeys.meNotifications }),
  });
}

/** Optimistic: the switch flips at once and snaps back if the server refuses. */
export function usePatchNotificationEvents() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { jobDone?: boolean; jobFailed?: boolean }) => api.me.notifications.patchEvents(body),
    onMutate: async (body) => {
      await queryClient.cancelQueries({ queryKey: queryKeys.meNotifications });
      const previous = queryClient.getQueryData<NotificationsView>(queryKeys.meNotifications);
      if (previous) {
        queryClient.setQueryData<NotificationsView>(queryKeys.meNotifications, {
          ...previous,
          events: { ...previous.events, ...body },
        });
      }
      return { previous };
    },
    onError: (_error, _body, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.meNotifications, context.previous);
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: queryKeys.meNotifications }),
  });
}

export function useTestNotification() {
  return useMutation({ mutationFn: () => api.me.notifications.test() });
}

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

// W1: NewSetDialog — creates a set, then refreshes the sidebar's set list.
export function useCreateSet() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { title: string; goal?: string }) => api.sets.create(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.sets });
    },
  });
}

// W1: NewNoteDialog ("Write a note") — creates a blank note, then refreshes that set's
// notes list (sidebar + SetHomePage both read it).
export function useCreateNote(set: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (title: string) => api.sets.createNote(set as string, title),
    onSuccess: () => {
      if (set) queryClient.invalidateQueries({ queryKey: queryKeys.notes(set) });
    },
  });
}

// W1: NotePage edit mode save — PUT the file, then refetch it (the saved `content` is
// raw file text; `FileView.file`'s cache holds the parsed { frontmatter, body } shape, so
// a refetch rather than a manual patch is what gets that split right).
export function useSaveFile(set: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ path, content, previous }: { path: string; content: string; previous: string }) =>
      api.sets.putFile(set as string, path, content, previous),
    onSuccess: (_result, { path }) => {
      if (!set) return;
      queryClient.invalidateQueries({ queryKey: queryKeys.file(set, path) });
      queryClient.invalidateQueries({ queryKey: queryKeys.notes(set) });
      queryClient.invalidateQueries({ queryKey: queryKeys.history(set, path) });
      if (path === "PLAN.md") {
        queryClient.invalidateQueries({ queryKey: queryKeys.sets });
        queryClient.invalidateQueries({ queryKey: queryKeys.course(set) });
      }
    },
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

/** A plan proposal's raw PLAN.md / curriculum.md fences and its suggested source URLs. */
export function usePlanProposal(set: string | undefined, file: string | undefined) {
  return useQuery<PlanProposal>({
    queryKey: [...queryKeys.inbox(set ?? ""), "plan", file ?? ""],
    queryFn: () => api.inbox.planProposal(set as string, file as string),
    enabled: !!set && !!file,
    retry: false,
  });
}

/** The set's built book PDF (`null` until one exists); refreshed when a compile-book job finishes. */
export function useBook(set: string | undefined) {
  return useQuery({
    queryKey: queryKeys.book(set ?? ""),
    queryFn: () => api.book.status(set as string),
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
  const jobStatusesRef = useRef<Map<string, JobView["status"]> | null>(null);
  if (jobStatusesRef.current === null) {
    const statuses = new Map<string, JobView["status"]>();
    for (const [, jobs] of queryClient.getQueriesData<JobView[]>({ queryKey: ["jobs"] })) {
      for (const job of jobs ?? []) {
        statuses.set(job.id, job.status);
        if (statuses.size > 100) {
          const oldestId = statuses.keys().next().value;
          if (oldestId !== undefined) statuses.delete(oldestId);
        }
      }
    }
    jobStatusesRef.current = statuses;
  }
  const jobStatuses = jobStatusesRef.current;

  useStudiumEvents((event) => {
    let jobStatusChanged = false;
    if (event.type === "job") {
      const { id, status } = event.job;
      jobStatusChanged = jobStatuses.get(id) !== status;
      jobStatuses.delete(id);
      jobStatuses.set(id, status);
      if (jobStatuses.size > 100) {
        const oldestId = jobStatuses.keys().next().value;
        if (oldestId !== undefined) jobStatuses.delete(oldestId);
      }
    }

    if (event.type === "commit" || event.type === "file" || jobStatusChanged) {
      queryClient.invalidateQueries({ queryKey: queryKeys.today });
    }
    if (["file", "commit", "job"].includes(event.type) || (event.type === "chat" && event.event.kind === "settled")) {
      queryClient.invalidateQueries({ queryKey: queryKeys.search });
    }
    if (
      event.type === "commit" ||
      event.type === "file" ||
      (event.type === "job" && ["make-quiz", "make-problems", "grade-answer"].includes(event.job.kind))
    ) {
      queryClient.invalidateQueries({ queryKey: ["practice"] });
    }
    if (event.type === "commit" || event.type === "file") {
      queryClient.invalidateQueries({ queryKey: ["highlights"] });
    }
    if (event.type === "file") {
      if (event.set) {
        queryClient.invalidateQueries({ queryKey: queryKeys.course(event.set) });
        queryClient.invalidateQueries({ queryKey: queryKeys.sources(event.set) });
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
      queryClient.invalidateQueries({ queryKey: queryKeys.recentlyDeleted });
      queryClient.invalidateQueries({ queryKey: queryKeys.sets });
      queryClient.invalidateQueries({ queryKey: ["inbox"] });
      queryClient.invalidateQueries({
        predicate: (query) => query.queryKey[0] === "sets" && ["course", "sources"].includes(String(query.queryKey[2])),
      });
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
      if (jobStatusChanged && job.set && (job.kind === "draft-chapter" || job.kind === "rewrite-chapter")) {
        queryClient.invalidateQueries({ queryKey: queryKeys.course(job.set) });
      }
      const finished = job.status === "done" || job.status === "failed" || job.status === "cancelled";
      // A finished draft-chapter job changes that set's Inbox and notes.
      if ((job.kind === "draft-chapter" || job.kind === "rewrite-chapter") && job.set && finished) {
        queryClient.invalidateQueries({ queryKey: queryKeys.inbox(job.set) });
        queryClient.invalidateQueries({ queryKey: queryKeys.notes(job.set) });
      }
      if (job.kind === "compile-book" && job.set && finished) {
        queryClient.invalidateQueries({ queryKey: queryKeys.book(job.set) });
      }
      // A finished plan-set job adds a plan proposal to that set's Inbox.
      if (job.kind === "plan-set" && job.set && finished) {
        queryClient.invalidateQueries({ queryKey: queryKeys.inbox(job.set) });
      }
      // A finished make-cards job (fresh drafts, or a count:0 re-check) changes the
      // target card file and its counts/stale flag in the cards list.
      if (job.kind === "make-cards" && job.set && finished) {
        queryClient.invalidateQueries({ queryKey: queryKeys.cardFiles(job.set) });
      }
      // Ingest jobs write new library entries (or update the pending one); refresh the
      // list and, once we know the source id, its detail page too.
      if ((job.kind === "ingest" || job.kind === "refresh-source") && finished) {
        queryClient.invalidateQueries({ queryKey: queryKeys.library });
        // A stale-cookie outcome flips Settings → Integrations while it is open.
        if (job.result?.transcriptStatus !== undefined) {
          queryClient.invalidateQueries({ queryKey: queryKeys.adminYoutube });
        }
        if (job.set) queryClient.invalidateQueries({ queryKey: queryKeys.sources(job.set) });
        const sourceId = job.result?.sourceId;
        if (sourceId) queryClient.invalidateQueries({ queryKey: queryKeys.librarySource(sourceId) });
      }
    }
  });
}
