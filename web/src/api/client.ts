import type {
  CardFileDetail,
  CardFileView,
  CardPatch,
  CardView,
  ChatMessage,
  ChatSummary,
  CommitInfo,
  FileView,
  InboxItem,
  JobKind,
  JobView,
  NoteSummary,
  ParsedFileView,
  SetSummary,
  SettingsView,
  SourceSummary,
} from "@studium/shared";

export type UserRole = "ADMIN" | "USER";
export type UserState = "NORMAL" | "ARCHIVED";

export interface User {
  id: number;
  username: string;
  displayName: string;
  email: string;
  avatarUrl: string;
  role: UserRole;
  state: UserState;
  aiEnabled: boolean;
  hasPassword: boolean;
  createdAt: string;
  updatedAt: string;
}

/** Public identity-provider shape offered on `/api/auth/status` — no secrets. */
export interface PublicIdentityProvider {
  id: number;
  title: string;
  authUrl: string;
  clientId: string;
  scopes: string[];
}

export interface AuthStatus {
  setupRequired: boolean;
  disallowPasswordAuth: boolean;
  instanceUrl: string;
  identityProviders: PublicIdentityProvider[];
}

export interface SsoRequest {
  providerId: number;
  code: string;
  redirectUri: string;
  codeVerifier?: string;
}

export interface LinkedIdentity {
  providerId: number;
  providerTitle: string;
  subject: string;
  createdAt: string;
}

export interface IdentityFieldMapping {
  identifier: string;
  displayName: string;
  email: string;
  avatarUrl: string;
}

export interface IdentityProviderAdmin {
  id: number;
  title: string;
  type: "OAUTH2";
  identifierFilter: string;
  clientId: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  fieldMapping: IdentityFieldMapping;
  hasClientSecret: boolean;
  autoLinkByEmail: boolean;
}

export interface IdentityProviderInput {
  title: string;
  type: "OAUTH2";
  identifierFilter: string;
  clientId: string;
  clientSecret?: string;
  authUrl: string;
  tokenUrl: string;
  userInfoUrl: string;
  scopes: string[];
  fieldMapping: IdentityFieldMapping;
  autoLinkByEmail: boolean;
}

export interface Session {
  id: string;
  userAgent: string;
  ip: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

export interface AccessTokenSummary {
  id: string;
  description: string;
  createdAt: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
}

// --- Backups (slice c) --------------------------------------------------------------

export type BackupDestination =
  | { type: "local"; path: string }
  | { type: "sftp"; host: string; port: number; user: string; path: string }
  | { type: "rest"; url: string; username?: string; password?: string }
  | {
      type: "s3";
      endpoint: string;
      bucket: string;
      prefix: string;
      accessKeyId: string;
      secretAccessKey: string;
      region?: string;
    }
  | { type: "rclone"; remote: string; path: string; rcloneConfig: string };

export type RedactedBackupDestination =
  | { type: "local"; path: string }
  | { type: "sftp"; host: string; port: number; user: string; path: string }
  | { type: "rest"; url: string; username?: string; hasPassword: boolean }
  | { type: "s3"; endpoint: string; bucket: string; prefix: string; region?: string; hasKeys: boolean }
  | { type: "rclone"; remote: string; path: string; hasConfig: boolean };

export interface BackupSchedule {
  enabled: boolean;
  time: string;
}
export interface BackupRetention {
  daily: number;
  weekly: number;
  monthly: number;
}
export interface BackupRunRecord {
  at: string;
  ok: boolean;
  message: string;
  snapshotId?: string;
}
export interface BackupCheckRecord {
  at: string;
  ok: boolean;
  message: string;
}
export interface RedactedBackupConfig {
  destination: RedactedBackupDestination | null;
  hasRepoPassword: boolean;
  schedule: BackupSchedule;
  retention: BackupRetention;
  lastRun: BackupRunRecord | null;
  lastCheck: BackupCheckRecord | null;
}
export interface BackupStatus {
  running: boolean;
  phase: string | null;
  startedAt: string | null;
  lastRun: BackupRunRecord | null;
}
export interface SnapshotInfo {
  id: string;
  shortId: string;
  time: string;
  paths: string[];
  sizeBytes?: number;
}
export interface RecoveryKit {
  repository: string;
  password: string;
  restoreSteps: string[];
}
export interface ProbeResult {
  ok: boolean;
  state: "empty" | "existing" | "error";
  message: string;
}
export interface RestoreResult {
  path: string;
  commitSha: string | null;
}

// --- Notifications + export (slice d) ------------------------------------------------

export interface NotificationsView {
  ntfy: { url: string; hasToken: boolean };
  vapidPublicKey: string;
  subscriptions: { id: string; userAgent: string; createdAt: string }[];
  events: { jobDone: boolean; jobFailed: boolean };
}

export class UnauthorizedError extends Error {
  constructor() {
    super("unauthorized");
    this.name = "UnauthorizedError";
  }
}

export class ApiError extends Error {
  status: number;
  body: unknown;

  constructor(status: number, message: string, body: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  // FormData sets its own multipart boundary in the Content-Type header; letting fetch
  // compute it (by not setting Content-Type ourselves) is required for multipart bodies.
  const isFormData = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    headers: {
      ...(init?.body && !isFormData ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (response.status === 401) {
    throw new UnauthorizedError();
  }

  if (!response.ok) {
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = undefined;
    }
    const message = (body as { error?: string } | undefined)?.error ?? response.statusText;
    throw new ApiError(response.status, message, body);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  // Some endpoints return 202 with a body (e.g. `POST /api/library` → `{ jobId }`) and
  // others with none (e.g. chat sendMessage); parse when there is something to parse.
  try {
    return (await response.json()) as T;
  } catch {
    return undefined as T;
  }
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

export const api = {
  auth: {
    status(): Promise<AuthStatus> {
      return request("/api/auth/status");
    },
    setup(body: { username: string; password: string; setupCode?: string }): Promise<{ user: User }> {
      return request("/api/auth/setup", { method: "POST", body: JSON.stringify(body) });
    },
    signin(username: string, password: string): Promise<{ user: User }> {
      return request("/api/auth/signin", { method: "POST", body: JSON.stringify({ username, password }) });
    },
    signout(): Promise<void> {
      return request("/api/auth/signout", { method: "POST" });
    },
    sso(body: SsoRequest): Promise<{ user: User }> {
      return request("/api/auth/sso", { method: "POST", body: JSON.stringify(body) });
    },
    // Compatibility aliases kept on the server; prefer signin/signout above.
    login(username: string, password: string): Promise<void> {
      return request("/api/auth/login", { method: "POST", body: JSON.stringify({ username, password }) });
    },
    logout(): Promise<void> {
      return request("/api/auth/logout", { method: "POST" });
    },
    me(): Promise<{ username: string }> {
      return request("/api/auth/me");
    },
  },

  me: {
    get(): Promise<{ user: User }> {
      return request("/api/me");
    },
    update(patch: { displayName?: string; email?: string; avatarUrl?: string }): Promise<{ user: User }> {
      return request("/api/me", { method: "PATCH", body: JSON.stringify(patch) });
    },
    changePassword(body: { currentPassword?: string; newPassword: string }): Promise<void> {
      return request("/api/me/password", { method: "POST", body: JSON.stringify(body) });
    },
    sessions(): Promise<{ sessions: Session[] }> {
      return request("/api/me/sessions");
    },
    revokeSession(id: string): Promise<void> {
      return request(`/api/me/sessions/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    accessTokens(): Promise<{ accessTokens: AccessTokenSummary[] }> {
      return request("/api/me/access-tokens");
    },
    createAccessToken(body: { description: string; expiresInDays?: number }): Promise<{ id: string; token: string }> {
      return request("/api/me/access-tokens", { method: "POST", body: JSON.stringify(body) });
    },
    deleteAccessToken(id: string): Promise<void> {
      return request(`/api/me/access-tokens/${encodeURIComponent(id)}`, { method: "DELETE" });
    },
    identities(): Promise<{ identities: LinkedIdentity[] }> {
      return request("/api/me/identities");
    },
    linkIdentity(body: SsoRequest): Promise<{ identity: LinkedIdentity }> {
      return request("/api/me/identities", { method: "POST", body: JSON.stringify(body) });
    },
    unlinkIdentity(providerId: number): Promise<void> {
      return request(`/api/me/identities/${providerId}`, { method: "DELETE" });
    },
    notifications: {
      get(): Promise<NotificationsView> {
        return request("/api/me/notifications");
      },
      putNtfy(body: { url: string; token?: string }): Promise<{ ntfy: { url: string; hasToken: boolean } }> {
        return request("/api/me/notifications/ntfy", { method: "PUT", body: JSON.stringify(body) });
      },
      subscribePush(body: {
        endpoint: string;
        keys: { p256dh: string; auth: string };
      }): Promise<{ subscription: { id: string; userAgent: string; createdAt: string } }> {
        return request("/api/me/notifications/push", { method: "POST", body: JSON.stringify(body) });
      },
      deletePush(id: string): Promise<void> {
        return request(`/api/me/notifications/push/${encodeURIComponent(id)}`, { method: "DELETE" });
      },
      patchEvents(body: { jobDone?: boolean; jobFailed?: boolean }): Promise<{ events: NotificationsView["events"] }> {
        return request("/api/me/notifications/events", { method: "PATCH", body: JSON.stringify(body) });
      },
      test(): Promise<{ ok: boolean }> {
        return request("/api/me/notifications/test", { method: "POST" });
      },
    },
  },

  admin: {
    users(): Promise<{ users: User[] }> {
      return request("/api/admin/users");
    },
    createUser(body: {
      username: string;
      password?: string;
      role: UserRole;
      displayName?: string;
      email?: string;
      aiEnabled?: boolean;
    }): Promise<{ user: User }> {
      return request("/api/admin/users", { method: "POST", body: JSON.stringify(body) });
    },
    updateUser(
      id: number,
      patch: {
        role?: UserRole;
        state?: UserState;
        aiEnabled?: boolean;
        displayName?: string;
        email?: string;
        password?: string;
      },
    ): Promise<{ user: User }> {
      return request(`/api/admin/users/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
    },
    deleteUser(id: number, opts?: { purge?: boolean }): Promise<void> {
      return request(`/api/admin/users/${id}${opts?.purge ? "?purge=1" : ""}`, { method: "DELETE" });
    },
    instance(): Promise<{ disallowPasswordAuth: boolean; instanceUrl: string }> {
      return request("/api/admin/instance");
    },
    updateInstance(patch: {
      disallowPasswordAuth?: boolean;
      instanceUrl?: string;
    }): Promise<{ disallowPasswordAuth: boolean; instanceUrl: string }> {
      return request("/api/admin/instance", { method: "PATCH", body: JSON.stringify(patch) });
    },
    identityProviders: {
      list(): Promise<{ identityProviders: IdentityProviderAdmin[] }> {
        return request("/api/admin/identity-providers");
      },
      create(body: IdentityProviderInput): Promise<{ identityProvider: IdentityProviderAdmin }> {
        return request("/api/admin/identity-providers", { method: "POST", body: JSON.stringify(body) });
      },
      update(id: number, body: Partial<IdentityProviderInput>): Promise<{ identityProvider: IdentityProviderAdmin }> {
        return request(`/api/admin/identity-providers/${id}`, { method: "PATCH", body: JSON.stringify(body) });
      },
      delete(id: number): Promise<void> {
        return request(`/api/admin/identity-providers/${id}`, { method: "DELETE" });
      },
    },
    backups: {
      get(): Promise<{ config: RedactedBackupConfig; resticVersion: string }> {
        return request("/api/admin/backups");
      },
      update(body: {
        schedule?: Partial<BackupSchedule>;
        retention?: Partial<BackupRetention>;
      }): Promise<{ config: RedactedBackupConfig }> {
        return request("/api/admin/backups", { method: "PATCH", body: JSON.stringify(body) });
      },
      test(destination: BackupDestination): Promise<ProbeResult> {
        return request("/api/admin/backups/test", { method: "POST", body: JSON.stringify({ destination }) });
      },
      init(destination: BackupDestination, existingPassword?: string): Promise<{ recoveryKit: RecoveryKit }> {
        return request("/api/admin/backups/init", {
          method: "POST",
          body: JSON.stringify({ destination, ...(existingPassword ? { existingPassword } : {}) }),
        });
      },
      run(): Promise<BackupStatus> {
        return request("/api/admin/backups/run", { method: "POST" });
      },
      status(): Promise<BackupStatus> {
        return request("/api/admin/backups/status");
      },
      snapshots(): Promise<{ snapshots: SnapshotInfo[] }> {
        return request("/api/admin/backups/snapshots");
      },
      restore(body: {
        snapshotId: string;
        scope: { type: "note" | "set"; username: string; path: string };
      }): Promise<RestoreResult> {
        return request("/api/admin/backups/restore", { method: "POST", body: JSON.stringify(body) });
      },
      check(): Promise<{ ok: boolean; message: string }> {
        return request("/api/admin/backups/check", { method: "POST" });
      },
      sftpKey(): Promise<{ publicKey: string }> {
        return request("/api/admin/backups/sftp-key", { method: "POST" });
      },
    },
  },

  sets: {
    list(): Promise<SetSummary[]> {
      return request("/api/sets");
    },
    // W1: NewSetDialog — creates `<slug>/PLAN.md` and empty notes/cards/log dirs.
    create(body: { title: string; goal?: string }): Promise<{ slug: string }> {
      return request("/api/sets", { method: "POST", body: JSON.stringify(body) });
    },
    notes(set: string): Promise<NoteSummary[]> {
      return request(`/api/sets/${encodeURIComponent(set)}/notes`);
    },
    // W1: "Write a note" flow (NewNoteDialog) — creates a blank `notes/NN-slug.md`.
    createNote(set: string, title: string): Promise<{ path: string }> {
      return request(`/api/sets/${encodeURIComponent(set)}/notes`, {
        method: "POST",
        body: JSON.stringify({ title }),
      });
    },
    file(set: string, path: string): Promise<FileView> {
      return request(`/api/sets/${encodeURIComponent(set)}/file${qs({ path })}`);
    },
    // W1: note editor save (NotePage edit mode). 409 body is `{ error: "changed", current }`;
    // callers read `ApiError.body` for `current` to offer "Overwrite".
    putFile(set: string, path: string, content: string, previous: string): Promise<{ sha: string | null }> {
      return request(`/api/sets/${encodeURIComponent(set)}/file`, {
        method: "PUT",
        body: JSON.stringify({ path, content, previous }),
      });
    },
    history(set: string, opts?: { path?: string; limit?: number }): Promise<CommitInfo[]> {
      return request(`/api/sets/${encodeURIComponent(set)}/history${qs({ path: opts?.path, limit: opts?.limit })}`);
    },
    diff(set: string, sha: string, path?: string): Promise<{ diff: string }> {
      return request(`/api/sets/${encodeURIComponent(set)}/diff${qs({ sha, path })}`);
    },
    revert(set: string, sha: string): Promise<{ sha: string }> {
      return request(`/api/sets/${encodeURIComponent(set)}/revert`, { method: "POST", body: JSON.stringify({ sha }) });
    },
  },

  chats: {
    list(set: string): Promise<ChatSummary[]> {
      return request(`/api/sets/${encodeURIComponent(set)}/chats`);
    },
    create(set: string): Promise<{ id: string }> {
      return request(`/api/sets/${encodeURIComponent(set)}/chats`, { method: "POST" });
    },
    get(set: string, id: string): Promise<{ id: string; messages: ChatMessage[]; running: boolean }> {
      return request(`/api/sets/${encodeURIComponent(set)}/chats/${encodeURIComponent(id)}`);
    },
    sendMessage(set: string, id: string, text: string, anchor?: string): Promise<void> {
      return request(`/api/sets/${encodeURIComponent(set)}/chats/${encodeURIComponent(id)}/messages`, {
        method: "POST",
        body: JSON.stringify({ text, ...(anchor ? { anchor } : {}) }),
      });
    },
    abort(set: string, id: string): Promise<void> {
      return request(`/api/sets/${encodeURIComponent(set)}/chats/${encodeURIComponent(id)}/abort`, { method: "POST" });
    },
  },

  library: {
    list(): Promise<SourceSummary[]> {
      return request("/api/library");
    },
    get(id: string): Promise<LibrarySourceView> {
      return request(`/api/library/${encodeURIComponent(id)}`);
    },
    addUrl(url: string, set?: string | null): Promise<LibraryAddResult> {
      return request("/api/library", {
        method: "POST",
        body: JSON.stringify({ url, ...(set ? { set } : {}) }),
      });
    },
    upload(file: File, set?: string | null): Promise<LibraryAddResult> {
      const form = new FormData();
      form.append("file", file);
      if (set) form.append("set", set);
      return request("/api/library", { method: "POST", body: form });
    },
    parsed(id: string, file: string): Promise<ParsedFileView> {
      return request(`/api/library/${encodeURIComponent(id)}/parsed${qs({ file })}`);
    },
  },

  settings: {
    get(): Promise<SettingsView> {
      return request("/api/settings");
    },
    saveModels(body: { default: string; roles: Record<string, string> }): Promise<SettingsView> {
      return request("/api/settings/models", { method: "PUT", body: JSON.stringify(body) });
    },
  },

  // T9b: Jobs panel (jobs list/create/cancel) — see docs/plans/2026-09-29-m1-sources-to-notes.md "New API".
  jobs: {
    list(set?: string): Promise<JobView[]> {
      return request(`/api/jobs${qs({ set })}`);
    },
    create(
      body:
        | { kind: Extract<JobKind, "draft-chapter">; set: string; title: string; brief?: string; sources?: string[] }
        | { kind: Extract<JobKind, "make-cards">; set: string; note: string; count?: number }
        | { proposalId: string },
    ): Promise<{ jobId: string }> {
      return request("/api/jobs", { method: "POST", body: JSON.stringify(body) });
    },
    cancel(id: string): Promise<void> {
      return request(`/api/jobs/${encodeURIComponent(id)}/cancel`, { method: "POST" });
    },
  },

  // T9b: Inbox (chapter review + accept).
  inbox: {
    list(set: string): Promise<InboxItem[]> {
      return request(`/api/sets/${encodeURIComponent(set)}/inbox`);
    },
    accept(set: string, path: string): Promise<{ sha: string }> {
      return request(`/api/sets/${encodeURIComponent(set)}/notes/accept`, {
        method: "POST",
        body: JSON.stringify({ path }),
      });
    },
  },

  // M2 T6: Cards (list, file detail, per-card patch, approve-all-clean, mark-exported).
  cards: {
    list(set: string): Promise<CardFileView[]> {
      return request(`/api/sets/${encodeURIComponent(set)}/cards`);
    },
    file(set: string, path: string): Promise<CardFileDetail> {
      return request(`/api/sets/${encodeURIComponent(set)}/cards/file${qs({ path })}`);
    },
    patch(set: string, id: string, body: CardPatch): Promise<CardView> {
      return request(`/api/sets/${encodeURIComponent(set)}/cards/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
    },
    approveClean(set: string, path: string): Promise<{ approved: number }> {
      return request(`/api/sets/${encodeURIComponent(set)}/cards/approve-clean`, {
        method: "POST",
        body: JSON.stringify({ path }),
      });
    },
    markExported(set: string, ids: string[], ankiIds?: Record<string, number>): Promise<{ updated: number }> {
      return request(`/api/sets/${encodeURIComponent(set)}/cards/exported`, {
        method: "POST",
        body: JSON.stringify({ ids, ...(ankiIds ? { ankiIds } : {}) }),
      });
    },
  },

  // M2 T6: server-side AnkiConnect sync (only available when ANKICONNECT_URL is set — a
  // 503 means "not configured", not a real failure; see anki.syncServer callers).
  anki: {
    syncServer(
      set: string,
      path?: string,
    ): Promise<{ added: number; updated: number; failed: { id: string; error: string }[] }> {
      return request(`/api/sets/${encodeURIComponent(set)}/anki/sync`, {
        method: "POST",
        body: JSON.stringify(path ? { path } : {}),
      });
    },
  },
};

/**
 * `GET /api/sets/:set/export.apkg` as a plain download link (not run through `request`,
 * which assumes a JSON response) — used directly as an `<a href>`.
 */
export function exportUrl(
  set: string,
  opts?: { cards?: "approved" | "approved+exported"; note?: string; mark?: 0 | 1 },
): string {
  return `/api/sets/${encodeURIComponent(set)}/export.apkg${qs({ cards: opts?.cards, note: opts?.note, mark: opts?.mark })}`;
}

/** `GET /api/library/:id` response shape (server's `SourceView`, not re-exported from shared). */
export interface LibrarySourceView {
  source: SourceSummary;
  body: string;
  parsedFiles: string[];
}

export type LibraryAddResult = { jobId: string } | { sourceId: string; deduped: true };

/** `GET /api/me/export[?withHistory=1]` as a plain download link — used as an `<a href>`. */
export function meExportUrl(opts?: { withHistory?: boolean }): string {
  return `/api/me/export${qs({ withHistory: opts?.withHistory ? 1 : undefined })}`;
}
