// Chat data/state, shared by the desktop dock and the mobile sheet shell (see ChatDock.tsx)
// so that opening/closing either one — or resizing across the lg breakpoint — never loses
// the selected chat or an in-flight stream. Extracted from what used to be ChatDockPanel's
// own body; the two shells only render around this.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useMemo, useReducer, useState } from "react";
import { toast } from "react-hot-toast";
import { ApiError, api } from "@/api/client";
import { useStudiumEvents } from "@/api/events";
import { type ChatDockState, chatDockReducer, initialChatDockState } from "./reducer";
import { useOpenNote } from "./useOpenNote";

export function useChatDock(set: string) {
  const { anchor, anchorRest } = useOpenNote();
  const queryClient = useQueryClient();

  const [chatId, setChatId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");

  const chatsQuery = useQuery({
    queryKey: ["sets", set, "chats"],
    queryFn: () => api.chats.list(set),
  });
  const chats = chatsQuery.data ?? [];

  // Default to the newest chat once the list loads, if nothing is selected yet.
  useEffect(() => {
    if (chatId === null && chats.length > 0) setChatId(chats[0]?.id ?? null);
  }, [chatId, chats]);

  // Dropping the whole set (e.g. switching study sets) drops the selected chat too.
  // biome-ignore lint/correctness/useExhaustiveDependencies: reset must run when `set` changes
  useEffect(() => {
    setChatId(null);
  }, [set]);

  const chatQuery = useQuery({
    queryKey: ["sets", set, "chats", chatId],
    queryFn: () => api.chats.get(set, chatId as string),
    enabled: chatId !== null,
  });

  const [state, dispatch] = useReducer(chatDockReducer, initialChatDockState(chatId));

  useEffect(() => {
    if (!chatQuery.data) return;
    dispatch({
      type: "reset",
      chatId: chatQuery.data.id,
      messages: chatQuery.data.messages,
      running: chatQuery.data.running,
    });
  }, [chatQuery.data]);

  useStudiumEvents((event) => {
    if (event.type !== "chat") return;
    if (event.set !== set || event.chatId !== chatId) return;
    dispatch({ type: "stream", chatId: event.chatId, event: event.event });
    // The server transcript is canonical (tool results, summaries): refetch once the turn settles.
    if (event.event.kind === "settled") {
      queryClient.invalidateQueries({ queryKey: ["sets", set, "chats"] });
    }
  });

  const createChat = useMutation({
    mutationFn: () => api.chats.create(set),
    onSuccess: ({ id }) => {
      queryClient.invalidateQueries({ queryKey: ["sets", set, "chats"] });
      setChatId(id);
    },
  });

  const sendMessage = useMutation({
    mutationFn: (text: string) => api.chats.sendMessage(set, chatId as string, text, anchor ?? undefined),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        toast.error("Chat is busy — wait for it to finish.");
        return;
      }
      toast.error(error instanceof ApiError ? error.message : "Failed to send message.");
    },
  });

  const abortChat = useMutation({
    mutationFn: () => api.chats.abort(set, chatId as string),
  });

  // T9b: Run a chat job-proposal card (decision 7) — POST /api/jobs {proposalId}, then mark
  // the card "started" with the new job's id so the card can link to /jobs.
  const startProposal = useMutation({
    mutationFn: (proposalId: string) => api.jobs.create({ proposalId }),
    onSuccess: ({ jobId }, proposalId) => {
      dispatch({ type: "proposal_started", proposalId, jobId });
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
    },
    onError: (error) => {
      toast.error(error instanceof ApiError ? error.message : "Failed to start job.");
    },
  });

  const dismissProposal = (proposalId: string) => {
    dispatch({ type: "proposal_dismissed", proposalId });
  };

  const handleSend = () => {
    const text = draft.trim();
    if (!text || !chatId || state.running) return;
    setDraft("");
    sendMessage.mutate(text);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      handleSend();
    }
  };

  const diffLink = useMemo(() => {
    if (!state.lastCommitSha || !anchorRest) return null;
    return `/s/${set}/n/${anchorRest}?commit=${state.lastCommitSha}`;
  }, [state.lastCommitSha, anchorRest, set]);

  return {
    chatId,
    setChatId,
    draft,
    setDraft,
    chats,
    state,
    createChat,
    abortChat,
    diffLink,
    handleSend,
    handleComposerKeyDown,
    startProposal,
    dismissProposal,
  };
}

export type UseChatDockResult = ReturnType<typeof useChatDock>;
export type { ChatDockState };
