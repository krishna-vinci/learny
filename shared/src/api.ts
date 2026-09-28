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
export type ChatStreamEvent =
  | { kind: "text_delta"; delta: string }
  | { kind: "tool_start"; toolCallId: string; name: string; args: Record<string, unknown> }
  | { kind: "tool_end"; toolCallId: string; name: string; isError: boolean; summary: string }
  | { kind: "message_end"; message: ChatMessage }
  | { kind: "settled"; commitSha: string | null }
  | { kind: "error"; message: string };
export type StudiumEvent =
  | { type: "file"; set: string | null; path: string; change: "add" | "change" | "unlink" }
  | { type: "commit"; sha: string; subject: string; author: string }
  | { type: "chat"; set: string; chatId: string; event: ChatStreamEvent };
