export interface SetSummary {
  slug: string;
  title: string;
  status: "draft" | "active" | "paused" | "done";
  level: number | null;
  deadline: string | null;
  nextAction: string | null;
}
/** Per-set study activity and pending work for `GET /api/today`. */
export interface TodaySet extends SetSummary {
  /** UTC calendar days until the deadline; negative means overdue. */
  daysLeft: number | null;
  inboxCount: number;
  draftCards: number;
  staleCardFiles: number;
  runningJobs: JobView[];
  /** Latest user-authored commit or chat file activity, as an ISO timestamp. */
  lastStudiedAt: string | null;
  nextChapter: string | null;
  notesCount: number;
}

export interface TodayItem {
  kind: "overdue" | "inbox" | "draft-cards" | "stale-cards" | "next-chapter" | "inactive";
  set: string;
  title: string;
  detail: string;
  href: string;
}

export interface TodayView {
  sets: TodaySet[];
  /** At most seven suggestions, in priority order. */
  doNext: TodayItem[];
}

export interface NoteSummary {
  path: string;
  title: string;
  order: number | null;
  status: "draft" | "checked" | "accepted" | null;
}
export interface FileView {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
  /** Exact file text on disk; the note editor edits this and sends it back as `previous`. */
  raw: string;
}
export interface CommitInfo {
  sha: string;
  date: string;
  author: string;
  subject: string;
}
export interface ChatSummary {
  id: string;
  title: string;
  created: string;
  modified: string;
  messageCount: number;
}
export interface ToolCallView {
  toolCallId: string;
  name: string;
  args: Record<string, unknown>;
  isError?: boolean;
  summary?: string;
}
export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  text: string;
  tools: ToolCallView[];
  timestamp: string;
}

export type SourceType = "book" | "paper" | "article" | "video" | "notes" | "other";
export type ParseTier = "basic" | "mineru" | "firecrawl" | "transcript";

// `library/<src-id>` summary as returned by `GET /api/library`.
export interface SourceSummary {
  id: string;
  title: string;
  authors: string[];
  type: SourceType;
  url: string | null;
  credibility: string | null;
  parseTier: ParseTier;
  addedAt: string;
  sets: string[];
  warning: string | null;
}

// `GET /api/library/:id/parsed?file=<name>`: one of a source's `parsedFiles`.
export interface ParsedFileView {
  file: string;
  markdown: string;
}

export type JobKind = "ingest" | "draft-chapter" | "make-cards";
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
/** How a job's model usage is billed: flat subscription, metered list price, or both. */
export type JobBilling = "subscription" | "metered" | "mixed";

export interface JobUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

export interface JobResult {
  notePath?: string;
  cardPath?: string;
  sourceId?: string;
  commitSha?: string;
  /** Non-fatal note (e.g. the source was stored but its summary is still pending). */
  warning?: string;
}

export interface JobView {
  id: string;
  kind: JobKind;
  set: string | null;
  title: string;
  status: JobStatus;
  progress: string;
  startedAt: string | null;
  finishedAt: string | null;
  usage: JobUsage;
  billing: JobBilling;
  result?: JobResult;
  error?: string;
}

export interface CheckIssue {
  severity: "blocker" | "major" | "minor";
  text: string;
}

export interface InboxItem {
  path: string;
  title: string;
  status: "draft" | "checked";
  check: { issues: CheckIssue[]; summary: string } | null;
  updatedAt: string;
}

export interface ServiceHealth {
  name: string;
  kind: "mcp" | "http";
  ok: boolean;
  detail: string;
  tools?: number;
}

// `GET /api/settings` view: configured role models plus live availability,
// warnings, and service health.
export interface SettingsView {
  models: { default: string; roles: Record<string, string> };
  available: string[];
  warnings: string[];
  services: ServiceHealth[];
}

export type ChatStreamEvent =
  | { kind: "text_delta"; delta: string }
  | { kind: "tool_start"; toolCallId: string; name: string; args: Record<string, unknown> }
  | { kind: "tool_end"; toolCallId: string; name: string; isError: boolean; summary: string }
  | { kind: "message_end"; message: ChatMessage }
  | { kind: "settled"; commitSha: string | null }
  | { kind: "error"; message: string }
  | {
      kind: "job_proposal";
      proposalId: string;
      jobKind: JobKind;
      title: string;
      estimate: { tokens: number; costUsd: number | null; billing?: JobBilling };
    };
export type StudiumEvent =
  | { type: "file"; set: string | null; path: string; change: "add" | "change" | "unlink" }
  | { type: "commit"; sha: string; subject: string; author: string }
  | { type: "chat"; set: string; chatId: string; event: ChatStreamEvent }
  | { type: "job"; job: JobView };

export type CardType = "basic" | "cloze";
export type CardStatus = "draft" | "approved" | "rejected" | "exported";
/** Statuses the learner may set from the review UI (never `exported` directly). */
export type CardPatchStatus = "draft" | "approved" | "rejected";

/** Critic verdict stored on a card's comment line, e.g. `critic: rule 4 (too many facts)`. */
export interface CardCritic {
  verdict: "ok" | "reject";
  rule?: number;
  reason?: string;
}

/** One card as returned by the cards API. Only the fields for the card's type are set. */
export interface CardView {
  id: string;
  type: CardType;
  status: CardStatus;
  q?: string;
  a?: string;
  text?: string;
  extra?: string;
  src?: string;
  critic?: CardCritic;
  ankiId?: number;
}

/** `GET /api/sets/:set/cards`: one entry per `<set>/cards/NN-slug.md`. */
export interface CardFileView {
  path: string;
  note: string | null;
  deck: string | null;
  stale: boolean;
  noteCommitsSince: number;
  counts: Record<CardStatus, number>;
  /** Present when this file could not be parsed completely; other files remain usable. */
  error?: string;
}

/** `GET /api/sets/:set/cards/file?path=…` */
export interface CardFileDetail {
  path: string;
  note: string | null;
  deck: string | null;
  stale: boolean;
  cards: CardView[];
  /** Present when this file could not be parsed completely. */
  error?: string;
}

/** `PATCH /api/sets/:set/cards/:id` body. */
export interface CardPatch {
  status?: CardPatchStatus;
  q?: string;
  a?: string;
  text?: string;
  extra?: string;
}
