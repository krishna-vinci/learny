import type {
  ChatMessage,
  ChatSummary,
  CommitInfo,
  FileView,
  InboxItem,
  JobKind,
  JobView,
  NoteSummary,
  SetSummary,
  SettingsView,
  SourceSummary,
} from "@studium/shared";

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

  sets: {
    list(): Promise<SetSummary[]> {
      return request("/api/sets");
    },
    notes(set: string): Promise<NoteSummary[]> {
      return request(`/api/sets/${encodeURIComponent(set)}/notes`);
    },
    file(set: string, path: string): Promise<FileView> {
      return request(`/api/sets/${encodeURIComponent(set)}/file${qs({ path })}`);
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
};

/** `GET /api/library/:id` response shape (server's `SourceView`, not re-exported from shared). */
export interface LibrarySourceView {
  source: SourceSummary;
  body: string;
  parsedFiles: string[];
}

export type LibraryAddResult = { jobId: string } | { sourceId: string; deduped: true };
