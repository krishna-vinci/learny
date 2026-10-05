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
  /** Always returned by the server; optional for older clients and fixtures. */
  chaptersToReview?: number;
  plansToReview?: number;
  draftCards: number;
  staleCardFiles: number;
  runningJobs: JobView[];
  /** Latest user-authored commit or chat file activity, as an ISO timestamp. */
  lastStudiedAt: string | null;
  nextChapter: string | null;
  notesCount: number;
  weakTopics: WeakSpot[];
  practiceDue: number;
}

export interface TodayItem {
  /** Distinguishes plan and chapter suggestions without changing legacy item kinds. */
  reviewKind?: "plan" | "chapter";
  kind: "overdue" | "inbox" | "draft-cards" | "stale-cards" | "practice" | "next-chapter" | "inactive";
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
  /**
   * Machine-readable outcome of the YouTube transcript ladder for embed-only
   * video sources. Null for every other source. Drives Retry eligibility.
   */
  transcriptStatus?: YoutubeTranscriptStatus | null;
  quality?: number;
  refreshedAt?: string;
  lastRefresh?: SourceRefreshResult;
}

/** Why the YouTube transcript ladder could not read a video (frontmatter value). */
export type YoutubeTranscriptStatus = "blocked" | "no-captions" | "disabled" | "unavailable";

/** `GET /api/admin/youtube/status`: engine + credential state, never secrets. */
export interface YoutubeIntegrationStatus {
  engine: {
    state: "found" | "missing";
    /** How the active binary was resolved; null when missing. */
    source: "env" | "managed" | "path" | null;
    version: string | null;
    /** Official release asset for this host, or null when unsupported. */
    asset: string | null;
    platformSupported: boolean;
    platformLabel: string;
    /** Node is always present (we run on Node); surfaced for the status copy. */
    nodePresent: boolean;
    /** A managed copy exists under the data dir (Install already ran). */
    managedInstalled: boolean;
    managedVersion: string | null;
    /** True when an env/path binary shadows the managed copy. */
    managedShadowed: boolean;
    /** YTDLP_PATH was set but unusable; the active engine came from a fallback. */
    envOverrideInvalid: boolean;
  };
  cookies: {
    source: "none" | "uploaded" | "env";
    configured: boolean;
    /** The configured file (env or uploaded) exists and reads as Netscape format. */
    readable: boolean;
    stale: boolean;
    lastSuccessAt: string | null;
    lastSuccessVideoId: string | null;
  };
  /** "basic" → no engine, "improved" → anonymous yt-dlp, "signed-in" → cookies. */
  mode: "basic" | "improved" | "signed-in";
  modeLabel: string;
  /** An extraction failure was seen that a newer yt-dlp release may fix. */
  updateRecommended: boolean;
}

// `GET /api/library/:id/parsed?file=<name>`: one of a source's `parsedFiles`.
export interface ParsedFileView {
  file: string;
  markdown: string;
}

/** `POST /api/library/site-map`; limit defaults to 100 and may be at most 500. */
export interface SiteMapRequest {
  url: string;
  search?: string;
  limit?: number;
}

export interface SiteMapPage {
  url: string;
  title?: string;
  description?: string;
}

export interface SiteMapResponse {
  pages: SiteMapPage[];
}

/** `POST /api/library/site-import`; 1–100 selected public URLs. */
export interface SiteImportRequest {
  urls: string[];
  set?: string;
}

export interface SiteImportResponse {
  /** Accepted pages, including pages waiting for one of this import's three slots. */
  queued: number;
  skipped: { url: string; reason: string }[];
}

export type JobKind =
  | "ingest"
  | "refresh-source"
  | "draft-chapter"
  | "rewrite-chapter"
  | "make-cards"
  | "compile-book"
  | "plan-set"
  | "make-quiz"
  | "make-problems"
  | "grade-answer";
export interface EvidenceCoverage {
  covered: number;
  total: number;
  weakest: string[];
  measuredAt: string;
}

export interface CourseChapter {
  evidence?: EvidenceCoverage;
  order: number;
  title: string;
  scope: string;
  prerequisites: string;
  state: "planned" | "drafting" | "drafted" | "checked" | "accepted";
  path?: string;
  jobId?: string;
}

export interface CourseView {
  subject: import("./schemas.js").PlanSubject;
  chapters: CourseChapter[];
}

export type JobStatus = "queued" | "running" | "done" | "failed" | "cancelled";
/** How a job's model usage is billed: flat subscription, metered list price, or both. */
export type JobBilling = "subscription" | "metered" | "mixed";

export interface JobUsage {
  exaRequests?: number;
  exaCostUsd?: number;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  costUsd: number;
}

export interface SourceRefreshResult {
  sourceId: string;
  before: number;
  after: number;
  status: "refreshed" | "unchanged" | "skipped";
  disappearedAnchors: string[];
  reason?: string;
}

export interface JobResult {
  refreshes?: SourceRefreshResult[];
  quizId?: string;
  problemFile?: string;
  practiceResult?: PracticeAttemptResult;
  proposalPath?: string;
  notePath?: string;
  cardPath?: string;
  sourceId?: string;
  commitSha?: string;
  /** Non-fatal note (e.g. the source was stored but its summary is still pending). */
  warning?: string;
  /** YouTube transcript ladder outcome for embed-only video sources. */
  transcriptStatus?: YoutubeTranscriptStatus;
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
  /** Missing kind means chapter, for compatibility with older items. */
  kind?: "chapter" | "plan";
  path: string;
  title: string;
  status: "draft" | "checked";
  check: { issues: CheckIssue[]; summary: string } | null;
  updatedAt: string;
}

export interface PlanProposalChapter {
  number: number;
  title: string;
  scope: string;
  prerequisites: string;
  ticked: boolean;
}

export interface PlanApprovalResponse {
  sha: string;
  jobIds: string[];
  ingestJobIds: string[];
}

export interface PlanProposal {
  /** The same fence-aware chapters used by approval; always present in new responses. */
  chapters?: PlanProposalChapter[];
  plan: string;
  curriculum: string;
  sourcesToAdd: string[];
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
export interface ExaBudgetStatus {
  month: string;
  spendUsd: number;
  warnUsd: number;
  stopUsd: number;
  status: "off" | "ready" | "warning" | "stopped" | "unavailable";
}

export interface SettingsView {
  exa?: ExaBudgetStatus;
  classifier?: {
    model: string | null;
    status: "configured" | "working" | "off";
    decisions: Record<string, { mode: "off" | "shadow" | "on"; threshold: number }>;
  };
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
      /** Selected note passage retained with card proposal sidecars. */
      passage?: string;
      jobKind: JobKind;
      title: string;
      estimate: { tokens: number; costUsd: number | null; billing?: JobBilling };
    };
export type StudiumEvent =
  | { type: "file"; set: string | null; path: string; change: "add" | "change" | "unlink" }
  | { type: "commit"; sha: string; subject: string; author: string }
  | { type: "chat"; set: string; chatId: string; event: ChatStreamEvent }
  | { type: "job"; job: JobView };

export type SearchKind = "note" | "source" | "card" | "chat";

/** Search paths are root-relative; cards include a #card-id fragment, chats use their session id. */
export interface SearchResult {
  kind: SearchKind;
  set: string | null;
  path: string;
  title: string;
  snippet: string;
  /** Higher scores rank first. FTS scores are negated bm25 values. */
  score: number;
}

export interface SearchResponse {
  results: SearchResult[];
}

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

export type HighlightColor = "yellow" | "green" | "blue" | "pink";

/**
 * One saved highlight from `<set>/highlights/<note-file>.json`. Anchored by
 * `quote` plus `prefix`/`suffix` so it survives small edits to the note.
 */
export interface Highlight {
  id: string;
  quote: string;
  prefix: string;
  suffix: string;
  color: HighlightColor;
  /** Optional learner annotation. */
  note?: string;
  createdAt: string;
}

/** `PATCH /api/sets/:set/highlights/:id` body; the note locates the highlight file. */
export interface HighlightPatch {
  note: string;
  color?: HighlightColor;
  /** Optional learner annotation, stored as the highlight's `note`. */
  comment?: string;
}

export type QuestionType = "mcq" | "multi" | "short" | "numeric" | "cloze";
export type PracticeResponse = string | number | string[];
export type PracticeVerdict = "right" | "partial" | "wrong";

/** Public question; private answers and explanations are never part of a quiz GET. */
export interface PracticeQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  options?: string[];
  unit?: string;
  note: string;
  anchor: string;
  topic: string;
  difficulty: 1 | 2 | 3;
  src?: string;
}
export interface PracticeQuiz {
  id: string;
  title: string;
  createdAt: string;
  questions: PracticeQuestion[];
}
export interface PracticeAttemptResult {
  id: string;
  questionId: string;
  score: number;
  verdict: PracticeVerdict;
  feedback: string;
  answer: string | number | string[] | { value: number; tolerance: number };
  explanation: string;
  note: string;
  anchor: string;
  topic: string;
  src?: string;
  solution?: string;
  revealed?: boolean;
}
export interface ProblemView {
  id: string;
  statement: string;
  note: string;
  anchor: string;
  topic: string;
  difficulty: 1 | 2 | 3;
  src?: string;
  answerType: "numeric" | "expression" | "short";
  hintCount: number;
}
export interface ProblemSetView {
  file: string;
  note: string;
  createdAt: string;
  problems: ProblemView[];
}
export interface TeachBackResult {
  id: string;
  note: string;
  topic: string;
  createdAt: string;
  accuracy: number;
  completeness: number;
  clarity: number;
  misconceptions: { claim: string; correction: string; citation: string }[];
  missing: string[];
  score: number;
  feedback: string;
}
export interface WeakSpot {
  topic: string;
  note: string;
  strength: number;
  attempts: number;
  lastSeen: string;
  nextReview: string;
  intervalDays: 1 | 2 | 4 | 8 | 16;
  gap: string;
}
export interface PracticeSummary {
  quizzes: { id: string; title: string; createdAt: string; questionCount: number; attempts: PracticeAttemptResult[] }[];
  problemSets: { file: string; note: string; createdAt: string; problemCount: number }[];
  teachbacks: TeachBackResult[];
  weakSpots: WeakSpot[];
  dueCount: number;
}
