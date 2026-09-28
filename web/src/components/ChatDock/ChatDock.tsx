import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PanelRightCloseIcon, PanelRightOpenIcon, PlusIcon, SendIcon, SquareIcon } from "lucide-react";
import { type CSSProperties, type KeyboardEvent, useEffect, useMemo, useReducer, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { Link } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { useStudiumEvents } from "@/api/events";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import ChatPicker from "./ChatPicker";
import MessageMarkdown from "./MessageMarkdown";
import ResizeHandle from "./ResizeHandle";
import { type ChatDockState, chatDockReducer, initialChatDockState } from "./reducer";
import ToolCallChip from "./ToolCallChip";
import { useChatDockCollapsed } from "./useChatDockCollapsed";
import useChatDockWidth, { CHAT_DOCK_WIDTH_VAR } from "./useChatDockWidth";
import { useOpenNote } from "./useOpenNote";

/** A message bubble, either a finalized ChatMessage or the in-flight streaming one. */
function MessageBubble({ message }: { message: ChatDockState["messages"][number] | ChatDockState["streaming"] }) {
  if (!message) return null;
  const isUser = message.role === "user";
  return (
    <div className={cn("flex flex-col", isUser ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2",
          isUser ? "bg-primary text-primary-foreground" : "bg-muted/70 text-foreground",
        )}
      >
        {message.tools.length > 0 && (
          <div className="mb-1 flex flex-col gap-1">
            {message.tools.map((tool) => (
              <ToolCallChip key={tool.toolCallId} tool={"status" in tool ? tool : { ...tool, status: "done" }} />
            ))}
          </div>
        )}
        {isUser ? (
          <p className="whitespace-pre-wrap break-words text-sm">{message.text}</p>
        ) : (
          <MessageMarkdown text={message.text} />
        )}
      </div>
    </div>
  );
}

function ChatDockPanel({ set }: { set: string }) {
  const { anchor, anchorRest } = useOpenNote();
  const { setCollapsed } = useChatDockCollapsed();
  const { width, minWidth, maxWidth, setWidth } = useChatDockWidth();
  const panelRef = useRef<HTMLDivElement>(null);
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

  const messages = state.messages;

  return (
    <div
      ref={panelRef}
      style={{ [CHAT_DOCK_WIDTH_VAR]: `${width}px` } as CSSProperties}
      className="relative hidden w-(--chat-dock-width) shrink-0 flex-col border-s border-border/70 bg-background lg:flex"
    >
      <ResizeHandle
        width={width}
        minWidth={minWidth}
        maxWidth={maxWidth}
        onWidthChange={setWidth}
        targetRef={panelRef}
      />

      <div className="flex h-11 shrink-0 items-center gap-1 border-b border-border/70 px-2">
        <ChatPicker chats={chats} activeChatId={chatId} onSelect={setChatId} />
        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                variant="quiet"
                size="icon-compact"
                onClick={() => createChat.mutate()}
                disabled={createChat.isPending}
              />
            }
          >
            <PlusIcon />
          </TooltipTrigger>
          <TooltipContent side="bottom">New chat</TooltipContent>
        </Tooltip>
        <div className="ms-auto">
          <Tooltip>
            <TooltipTrigger render={<Button variant="quiet" size="icon-compact" onClick={() => setCollapsed(true)} />}>
              <PanelRightCloseIcon />
            </TooltipTrigger>
            <TooltipContent side="bottom">Collapse chat</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3 py-3">
        {chatId === null ? (
          <p className="p-2 text-sm text-muted-foreground">No chats yet — start one.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {state.streaming && <MessageBubble message={state.streaming} />}
            {diffLink && (
              <div className="rounded-md border border-border/70 bg-muted/40 px-3 py-2 text-sm">
                Changes saved ·{" "}
                <Link to={diffLink} className="text-primary underline">
                  view diff
                </Link>
              </div>
            )}
          </div>
        )}
      </ScrollArea>

      <div className="shrink-0 border-t border-border/70 p-2">
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          disabled={!chatId || state.running}
          placeholder={chatId ? "Message the tutor…" : "Start a chat first"}
          rows={3}
          className="w-full resize-none rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        <div className="mt-1.5 flex justify-end">
          {state.running ? (
            <Button variant="outline" size="sm" onClick={() => abortChat.mutate()}>
              <SquareIcon /> Stop
            </Button>
          ) : (
            <Button size="sm" onClick={handleSend} disabled={!chatId || draft.trim() === ""}>
              <SendIcon /> Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

function CollapsedRail() {
  const { setCollapsed } = useChatDockCollapsed();
  return (
    <div className="hidden w-9 shrink-0 flex-col items-center border-s border-border/70 bg-background pt-2 lg:flex">
      <Tooltip>
        <TooltipTrigger render={<Button variant="quiet" size="icon-compact" onClick={() => setCollapsed(false)} />}>
          <PanelRightOpenIcon />
        </TooltipTrigger>
        <TooltipContent side="left">Open chat</TooltipContent>
      </Tooltip>
    </div>
  );
}

/** Right-hand chat dock: chat picker, streaming transcript, and composer. */
function ChatDock() {
  const { set } = useOpenNote();
  const { collapsed } = useChatDockCollapsed();

  if (!set) {
    return <div className="hidden w-9 shrink-0 border-s border-border/70 lg:block" />;
  }

  return <TooltipProvider>{collapsed ? <CollapsedRail /> : <ChatDockPanel set={set} />}</TooltipProvider>;
}

export default ChatDock;
