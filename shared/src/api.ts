export interface SetSummary {
  slug: string;
  title: string;
  status: "draft" | "active" | "paused" | "done";
  level: number | null;
  deadline: string | null;
  nextAction: string | null;
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

export type JobKind = "ingest" | "draft-chapter";
export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";

export interface JobUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

export interface JobResult {
  notePath?: string;
  sourceId?: string;
  commitSha?: string;
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
      estimate: { tokens: number; costUsd: number | null };
    };
export type StudiumEvent =
  | { type: "file"; set: string | null; path: string; change: "add" | "change" | "unlink" }
  | { type: "commit"; sha: string; subject: string; author: string }
  | { type: "chat"; set: string; chatId: string; event: ChatStreamEvent }
  | { type: "job"; job: JobView };
