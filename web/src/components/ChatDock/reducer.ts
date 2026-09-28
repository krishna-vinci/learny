import type { ChatMessage, ChatStreamEvent, ToolCallView } from "@studium/shared";

/** A tool call as shown while its message is still streaming in. */
export interface StreamingToolCall extends ToolCallView {
  status: "running" | "done";
}

/** The assistant message currently being assembled from `text_delta`/`tool_*` events. */
export interface StreamingMessage {
  id: string;
  role: "assistant";
  text: string;
  tools: StreamingToolCall[];
}

type JobProposalEvent = Extract<ChatStreamEvent, { kind: "job_proposal" }>;

/**
 * A Tutor `start_job` proposal (decision 7): rendered as a Run/Dismiss card attached to
 * whichever assistant message was streaming — or, if none was, the last one — when the
 * `job_proposal` event arrived. `messageId` is retargeted from the streaming placeholder id
 * to the real message id once `message_end` lands (see `applyStreamEvent`).
 */
export interface JobProposalCard {
  proposalId: string;
  jobKind: JobProposalEvent["jobKind"];
  title: string;
  estimate: JobProposalEvent["estimate"];
  messageId: string;
  status: "pending" | "started" | "dismissed";
  jobId?: string;
}

export interface ChatDockState {
  /** The chat this state belongs to; stream events for any other chat id are ignored. */
  chatId: string | null;
  messages: ChatMessage[];
  streaming: StreamingMessage | null;
  running: boolean;
  lastCommitSha: string | null;
  error: string | null;
  proposals: JobProposalCard[];
}

export type ChatDockAction =
  | { type: "reset"; chatId: string | null; messages: ChatMessage[]; running: boolean }
  | { type: "stream"; chatId: string; event: ChatStreamEvent }
  | { type: "proposal_started"; proposalId: string; jobId: string }
  | { type: "proposal_dismissed"; proposalId: string };

export function initialChatDockState(chatId: string | null = null): ChatDockState {
  return {
    chatId,
    messages: [],
    streaming: null,
    running: false,
    lastCommitSha: null,
    error: null,
    proposals: [],
  };
}

function startStreaming(state: ChatDockState): StreamingMessage {
  return state.streaming ?? { id: "streaming", role: "assistant", text: "", tools: [] };
}

function applyStreamEvent(state: ChatDockState, event: ChatStreamEvent): ChatDockState {
  switch (event.kind) {
    case "text_delta": {
      const streaming = startStreaming(state);
      return { ...state, running: true, streaming: { ...streaming, text: streaming.text + event.delta } };
    }
    case "tool_start": {
      const streaming = startStreaming(state);
      const tool: StreamingToolCall = {
        toolCallId: event.toolCallId,
        name: event.name,
        args: event.args,
        status: "running",
      };
      return { ...state, running: true, streaming: { ...streaming, tools: [...streaming.tools, tool] } };
    }
    case "tool_end": {
      if (!state.streaming) return state;
      const tools = state.streaming.tools.map((tool) =>
        tool.toolCallId === event.toolCallId
          ? { ...tool, status: "done" as const, isError: event.isError, summary: event.summary }
          : tool,
      );
      return { ...state, streaming: { ...state.streaming, tools } };
    }
    case "message_end": {
      // The proposal was attached to the streaming placeholder ("streaming"); retarget it to
      // the now-finalized message id so it keeps rendering under the same bubble.
      const proposals = state.proposals.map((proposal) =>
        proposal.messageId === "streaming" ? { ...proposal, messageId: event.message.id } : proposal,
      );
      return { ...state, messages: [...state.messages, event.message], streaming: null, proposals };
    }
    case "settled": {
      return { ...state, running: false, streaming: null, lastCommitSha: event.commitSha };
    }
    case "error": {
      return { ...state, running: false, error: event.message };
    }
    case "job_proposal": {
      const messageId = state.streaming ? state.streaming.id : (state.messages.at(-1)?.id ?? "streaming");
      const proposal: JobProposalCard = {
        proposalId: event.proposalId,
        jobKind: event.jobKind,
        title: event.title,
        estimate: event.estimate,
        messageId,
        status: "pending",
      };
      return { ...state, proposals: [...state.proposals, proposal] };
    }
    default:
      return state;
  }
}

export function chatDockReducer(state: ChatDockState, action: ChatDockAction): ChatDockState {
  if (action.type === "reset") {
    return {
      chatId: action.chatId,
      messages: action.messages,
      streaming: null,
      running: action.running,
      // Keep the diff card when the same chat is refetched after `settled`.
      lastCommitSha: action.chatId === state.chatId ? state.lastCommitSha : null,
      error: null,
      proposals: [],
    };
  }
  if (action.type === "proposal_started") {
    return {
      ...state,
      proposals: state.proposals.map((proposal) =>
        proposal.proposalId === action.proposalId ? { ...proposal, status: "started", jobId: action.jobId } : proposal,
      ),
    };
  }
  if (action.type === "proposal_dismissed") {
    return {
      ...state,
      proposals: state.proposals.map((proposal) =>
        proposal.proposalId === action.proposalId ? { ...proposal, status: "dismissed" } : proposal,
      ),
    };
  }
  // Events belong to a specific chat id; drop anything for a chat that isn't open.
  if (state.chatId === null || action.chatId !== state.chatId) return state;
  return applyStreamEvent(state, action.event);
}
