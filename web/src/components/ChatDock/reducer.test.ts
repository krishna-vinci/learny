import type { ChatMessage, ChatStreamEvent } from "@studium/shared";
import { describe, expect, it } from "vitest";
import { type ChatDockState, chatDockReducer, initialChatDockState } from "./reducer";

function stream(state: ChatDockState, chatId: string, event: ChatStreamEvent): ChatDockState {
  return chatDockReducer(state, { type: "stream", chatId, event });
}

describe("chatDockReducer", () => {
  it("resets to a fresh state for the given chat", () => {
    const messages: ChatMessage[] = [
      { id: "m1", role: "user", text: "hi", tools: [], timestamp: "2026-01-01T00:00:00Z" },
    ];
    const state = chatDockReducer(initialChatDockState(null), { type: "reset", chatId: "c1", messages, running: true });
    expect(state).toEqual({
      chatId: "c1",
      messages,
      streaming: null,
      running: true,
      lastCommitSha: null,
      error: null,
      proposals: [],
    });
  });

  it("appends text_delta events to the streaming message", () => {
    let state = initialChatDockState("c1");
    state = stream(state, "c1", { kind: "text_delta", delta: "Hel" });
    state = stream(state, "c1", { kind: "text_delta", delta: "lo" });
    expect(state.streaming).toEqual({ id: "streaming", role: "assistant", text: "Hello", tools: [] });
    expect(state.running).toBe(true);
  });

  it("tracks tool_start then tool_end for the same tool call", () => {
    let state = initialChatDockState("c1");
    state = stream(state, "c1", {
      kind: "tool_start",
      toolCallId: "t1",
      name: "edit_note",
      args: { path: "notes/a.md" },
    });
    expect(state.streaming?.tools).toEqual([
      { toolCallId: "t1", name: "edit_note", args: { path: "notes/a.md" }, status: "running" },
    ]);

    state = stream(state, "c1", {
      kind: "tool_end",
      toolCallId: "t1",
      name: "edit_note",
      isError: false,
      summary: "Edited 1 line",
    });
    expect(state.streaming?.tools).toEqual([
      {
        toolCallId: "t1",
        name: "edit_note",
        args: { path: "notes/a.md" },
        status: "done",
        isError: false,
        summary: "Edited 1 line",
      },
    ]);
  });

  it("finalizes the streaming message on message_end", () => {
    let state = initialChatDockState("c1");
    state = stream(state, "c1", { kind: "text_delta", delta: "Hi there" });
    const finalMessage: ChatMessage = {
      id: "m2",
      role: "assistant",
      text: "Hi there",
      tools: [],
      timestamp: "2026-01-01T00:00:01Z",
    };
    state = stream(state, "c1", { kind: "message_end", message: finalMessage });
    expect(state.streaming).toBeNull();
    expect(state.messages).toEqual([finalMessage]);
  });

  it("records the commit sha and clears running on settled", () => {
    let state = initialChatDockState("c1");
    state = { ...state, running: true };
    state = stream(state, "c1", { kind: "settled", commitSha: "abc123" });
    expect(state.running).toBe(false);
    expect(state.lastCommitSha).toBe("abc123");
    expect(state.streaming).toBeNull();
  });

  it("ignores stream events for a different chat id", () => {
    const state = initialChatDockState("c1");
    const next = stream(state, "c2", { kind: "text_delta", delta: "nope" });
    expect(next).toBe(state);
  });

  it("ignores stream events when no chat is open", () => {
    const state = initialChatDockState(null);
    const next = stream(state, "c1", { kind: "text_delta", delta: "nope" });
    expect(next).toBe(state);
  });
});

describe("job_proposal", () => {
  it("attaches a pending proposal to the streaming message", () => {
    let state = initialChatDockState("c1");
    state = stream(state, "c1", { kind: "text_delta", delta: "Let's draft it" });
    state = stream(state, "c1", {
      kind: "job_proposal",
      proposalId: "p1",
      jobKind: "draft-chapter",
      title: "Draft: SVD",
      estimate: { tokens: 12000, costUsd: null },
    });
    expect(state.proposals).toEqual([
      {
        proposalId: "p1",
        jobKind: "draft-chapter",
        title: "Draft: SVD",
        estimate: { tokens: 12000, costUsd: null },
        messageId: "streaming",
        status: "pending",
      },
    ]);
  });

  it("attaches to the last assistant message when nothing is streaming", () => {
    let state = chatDockReducer(initialChatDockState(), {
      type: "reset",
      chatId: "c1",
      messages: [{ id: "m1", role: "assistant", text: "hi", tools: [], timestamp: "2026-01-01T00:00:00Z" }],
      running: false,
    });
    state = stream(state, "c1", {
      kind: "job_proposal",
      proposalId: "p1",
      jobKind: "draft-chapter",
      title: "Draft: SVD",
      estimate: { tokens: 12000, costUsd: 0.04 },
    });
    expect(state.proposals[0]?.messageId).toBe("m1");
  });

  it("retargets a streaming proposal's messageId once the message finalizes", () => {
    let state = initialChatDockState("c1");
    state = stream(state, "c1", {
      kind: "job_proposal",
      proposalId: "p1",
      jobKind: "draft-chapter",
      title: "Draft: SVD",
      estimate: { tokens: 12000, costUsd: null },
    });
    const finalMessage: ChatMessage = {
      id: "m2",
      role: "assistant",
      text: "Want me to draft it?",
      tools: [],
      timestamp: "2026-01-01T00:00:01Z",
    };
    state = stream(state, "c1", { kind: "message_end", message: finalMessage });
    expect(state.proposals[0]?.messageId).toBe("m2");
  });

  it("marks a proposal started with its jobId, ignoring other proposals", () => {
    let state = initialChatDockState("c1");
    state = stream(state, "c1", {
      kind: "job_proposal",
      proposalId: "p1",
      jobKind: "draft-chapter",
      title: "Draft: SVD",
      estimate: { tokens: 12000, costUsd: null },
    });
    state = chatDockReducer(state, { type: "proposal_started", proposalId: "p1", jobId: "job-1" });
    expect(state.proposals[0]).toMatchObject({ status: "started", jobId: "job-1" });
  });

  it("marks a proposal dismissed", () => {
    let state = initialChatDockState("c1");
    state = stream(state, "c1", {
      kind: "job_proposal",
      proposalId: "p1",
      jobKind: "draft-chapter",
      title: "Draft: SVD",
      estimate: { tokens: 12000, costUsd: null },
    });
    state = chatDockReducer(state, { type: "proposal_dismissed", proposalId: "p1" });
    expect(state.proposals[0]?.status).toBe("dismissed");
  });

  it("clears proposals on reset", () => {
    let state = initialChatDockState("c1");
    state = stream(state, "c1", {
      kind: "job_proposal",
      proposalId: "p1",
      jobKind: "draft-chapter",
      title: "Draft: SVD",
      estimate: { tokens: 12000, costUsd: null },
    });
    state = chatDockReducer(state, { type: "reset", chatId: "c1", messages: [], running: false });
    expect(state.proposals).toEqual([]);
  });
});

describe("reset after settled", () => {
  it("keeps lastCommitSha when the same chat is refetched", () => {
    let state = chatDockReducer(initialChatDockState(), { type: "reset", chatId: "c1", messages: [], running: false });
    state = chatDockReducer(state, { type: "stream", chatId: "c1", event: { kind: "settled", commitSha: "abc123" } });
    state = chatDockReducer(state, { type: "reset", chatId: "c1", messages: [], running: false });
    expect(state.lastCommitSha).toBe("abc123");
    state = chatDockReducer(state, { type: "reset", chatId: "c2", messages: [], running: false });
    expect(state.lastCommitSha).toBeNull();
  });
});
