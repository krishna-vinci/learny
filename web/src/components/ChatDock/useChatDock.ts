// Chat data/state, shared by the desktop dock and the mobile sheet shell (see ChatDock.tsx)
// so that opening/closing either one — or resizing across the lg breakpoint — never loses
// the selected chat or an in-flight stream. Extracted from what used to be ChatDockPanel's
// own body; the two shells only render around this.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { type KeyboardEvent, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { ApiError, api } from "@/api/client";
import { useStudiumEvents } from "@/api/events";
import { showJobStartedToast } from "@/components/Activity/job-start-toast";
import { friendlyMessage } from "@/lib/friendly-errors";
import { toast } from "@/lib/notify";
import { type ChatDockRequest, OPEN_CHAT_DOCK_EVENT, takeChatDockRequest } from "./openChatDock";
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

  // Pending Tutor proposals outlive the live stream: merge the persisted ones in on chat
  // load/switch and after each refetch (a `reset` clears the cards).
  const proposalsQuery = useQuery({
    queryKey: ["sets", set, "chats", chatId, "proposals"],
    queryFn: () => api.chats.proposals(set, chatId as string),
    enabled: chatId !== null,
  });
  const loadedProposals = proposalsQuery.data?.proposals;
  // biome-ignore lint/correctness/useExhaustiveDependencies: `state.messages` re-merges after a reset clears the cards
  useEffect(() => {
    if (loadedProposals && state.chatId !== null) {
      dispatch({ type: "proposals_loaded", chatId: state.chatId, proposals: loadedProposals });
    }
  }, [loadedProposals, state.chatId, state.messages]);

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
    mutationFn: ({
      id,
      text,
      quote,
      messageAnchor,
    }: {
      id: string;
      text: string;
      quote?: string;
      messageAnchor?: string;
    }) => api.chats.sendMessage(set, id, text, messageAnchor ?? anchor ?? undefined, quote),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        toast.error("Chat is busy — wait for it to finish.");
        return;
      }
      toast.error(friendlyMessage(error, "Failed to send message."));
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
      showJobStartedToast(state.proposals.find((proposal) => proposal.proposalId === proposalId)?.title ?? "job");
      queryClient.invalidateQueries({ queryKey: ["jobs"] });
      queryClient.invalidateQueries({ queryKey: ["sets", set, "chats", chatId, "proposals"] });
    },
    onError: (error, proposalId) => {
      if (error instanceof ApiError && error.status === 404) {
        // Expired or already consumed: the card can't run any more.
        dispatch({ type: "proposal_dismissed", proposalId });
        queryClient.invalidateQueries({ queryKey: ["sets", set, "chats", chatId, "proposals"] });
        toast.error("This suggestion expired.");
        return;
      }
      toast.error(friendlyMessage(error, "Failed to start job."));
    },
  });

  const dismissProposal = (proposalId: string) => {
    dispatch({ type: "proposal_dismissed", proposalId });
    if (chatId === null) return;
    // Best effort: the card is already gone locally, and an expired proposal is gone server-side.
    api.chats
      .dismissProposal(set, chatId, proposalId)
      .catch(() => undefined)
      .finally(() => queryClient.invalidateQueries({ queryKey: ["sets", set, "chats", chatId, "proposals"] }));
  };

  // With no chat open, the first message starts one, so the composer is never a dead end.
  const handleSend = async (request?: ChatDockRequest) => {
    const text = (request?.text ?? draft).trim();
    if (!text) return;
    if (state.running || createChat.isPending || sendMessage.isPending) {
      toast.error("Chat is busy — wait for it to finish.");
      return;
    }
    setDraft("");
    let id = chatId;
    if (id === null) {
      try {
        id = (await createChat.mutateAsync()).id;
      } catch {
        setDraft(text);
        toast.error("Could not start a chat.");
        return;
      }
    }
    sendMessage.mutate({ id, text, quote: request?.quote, messageAnchor: request?.anchor });
  };

  const requestHandler = useRef<(request: ChatDockRequest) => void>(() => {});
  requestHandler.current = (request) => {
    if (request.chatId) setChatId(request.chatId);
    if (request.text) void handleSend(request);
  };
  useEffect(() => {
    const consume = () => {
      const request = takeChatDockRequest(set);
      if (!request) return;
      requestHandler.current(request);
      // Shell listeners may have mounted after the original navigation request.
      window.dispatchEvent(new Event(OPEN_CHAT_DOCK_EVENT));
    };
    window.addEventListener(OPEN_CHAT_DOCK_EVENT, consume);
    consume();
    return () => window.removeEventListener(OPEN_CHAT_DOCK_EVENT, consume);
  }, [set]);

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void handleSend();
    }
  };

  const diffLink = useMemo(() => {
    if (!state.lastCommitSha || !anchorRest) return null;
    return `/s/${set}/n/${anchorRest}?commit=${state.lastCommitSha}`;
  }, [state.lastCommitSha, anchorRest, set]);

  return {
    notePath: `${set}/${anchor ?? "notes/chat.md"}`,
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
