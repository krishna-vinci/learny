// The chat dock's presentational core: header (picker/new-chat/`headerEnd` slot), the
// scrolling transcript, and the composer. Used as-is by both the desktop dock (lg+) and
// the mobile full-screen sheet — see DesktopChatDock.tsx / MobileChatDock.tsx.
import { ArrowDownIcon, PlusIcon, SendIcon, SquareIcon } from "lucide-react";
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatEstimate } from "@/lib/job-format";
import { cn } from "@/lib/utils";
import ChatPicker from "./ChatPicker";
import MessageMarkdown from "./MessageMarkdown";
import type { ChatDockState, JobProposalCard } from "./reducer";
import ToolCallChip from "./ToolCallChip";
import type { UseChatDockResult } from "./useChatDock";

/** Decision 7's chat job-proposal card: title, estimate, and Run / Dismiss. */
function ProposalCard({
  proposal,
  isStarting,
  onRun,
  onDismiss,
}: {
  proposal: JobProposalCard;
  isStarting: boolean;
  onRun: () => void;
  onDismiss: () => void;
}) {
  if (proposal.status === "started") {
    return (
      <div className="mt-1 max-w-[85%] rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-sm">
        <p className="font-medium text-foreground">{proposal.title}</p>
        <p className="mt-1 text-muted-foreground">
          Started ·{" "}
          <Link to="/jobs" className="text-primary underline">
            view in Jobs
          </Link>
        </p>
      </div>
    );
  }
  return (
    <div className="mt-1 max-w-[85%] rounded-lg border border-border/70 bg-muted/40 px-3 py-2 text-sm">
      <p className="font-medium text-foreground">{proposal.title}</p>
      <p className="mt-0.5 text-2xs uppercase tracking-wide text-muted-foreground/70">{proposal.jobKind}</p>
      <p className="mt-1 text-muted-foreground">{formatEstimate(proposal.estimate)}</p>
      <div className="mt-2 flex gap-2">
        <Button size="sm" onClick={onRun} disabled={isStarting}>
          {isStarting ? "Starting…" : "Run"}
        </Button>
        <Button size="sm" variant="outline" onClick={onDismiss} disabled={isStarting}>
          Dismiss
        </Button>
      </div>
    </div>
  );
}

/** A message bubble, either a finalized ChatMessage or the in-flight streaming one, plus any
 * job-proposal cards attached to it. */
function MessageBubble({
  message,
  proposals,
  startingProposalId,
  onRunProposal,
  onDismissProposal,
}: {
  message: ChatDockState["messages"][number] | ChatDockState["streaming"];
  proposals: JobProposalCard[];
  startingProposalId: string | undefined;
  onRunProposal: (proposalId: string) => void;
  onDismissProposal: (proposalId: string) => void;
}) {
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
      {proposals.map((proposal) => (
        <ProposalCard
          key={proposal.proposalId}
          proposal={proposal}
          isStarting={startingProposalId === proposal.proposalId}
          onRun={() => onRunProposal(proposal.proposalId)}
          onDismiss={() => onDismissProposal(proposal.proposalId)}
        />
      ))}
    </div>
  );
}

export interface ChatPanelProps {
  chat: UseChatDockResult;
  /** Rendered at the end of the header row: the collapse button on desktop, the close
   * button on the mobile sheet. */
  headerEnd?: ReactNode;
  className?: string;
  /** Extra classes for the composer wrapper, e.g. safe-area padding on the mobile sheet. */
  composerClassName?: string;
}

function ChatPanel({ chat, headerEnd, className, composerClassName }: ChatPanelProps) {
  const {
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
  } = chat;
  const startingProposalId = startProposal.isPending ? startProposal.variables : undefined;

  // Keep the transcript pinned to the newest message: snap to the bottom on mount (the
  // mobile sheet mounts a fresh ChatPanel each time it opens), whenever the chat is
  // switched, and while new messages/deltas/cards arrive — but only if the user was
  // already near the bottom. If they scrolled up to read history, leave them there and
  // show a jump-to-latest button instead of yanking the view down.
  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const [showJumpButton, setShowJumpButton] = useState(false);
  const prevChatIdRef = useRef(chatId);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
    });
  }, []);

  // Chat switched: resume auto-pinning to the bottom for the newly selected chat.
  useEffect(() => {
    if (prevChatIdRef.current !== chatId) {
      prevChatIdRef.current = chatId;
      stickToBottomRef.current = true;
      setShowJumpButton(false);
    }
  }, [chatId]);

  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const nearBottom = distanceFromBottom < 80;
    stickToBottomRef.current = nearBottom;
    setShowJumpButton(!nearBottom);
  }, []);

  // Pin to the bottom on mount/chat-switch and whenever content changes, as long as the
  // user hasn't scrolled away from the bottom.
  // biome-ignore lint/correctness/useExhaustiveDependencies: deps are triggers to re-check the pin, not values read in the body
  useEffect(() => {
    if (stickToBottomRef.current) {
      scrollToBottom();
      setShowJumpButton(false);
    }
  }, [chatId, state.messages, state.streaming, state.proposals, scrollToBottom]);

  const jumpToLatest = () => {
    stickToBottomRef.current = true;
    scrollToBottom("smooth");
    setShowJumpButton(false);
  };

  return (
    <div className={cn("flex h-full min-h-0 flex-col bg-background", className)}>
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
                aria-label="New chat"
              />
            }
          >
            <PlusIcon />
          </TooltipTrigger>
          <TooltipContent side="bottom">New chat</TooltipContent>
        </Tooltip>
        {headerEnd && <div className="ms-auto flex items-center">{headerEnd}</div>}
      </div>

      <div className="relative min-h-0 flex-1">
        <ScrollArea ref={scrollRef} onScroll={handleScroll} className="h-full px-3 py-3">
          {chatId === null ? (
            <p className="p-2 text-sm text-muted-foreground">No chats yet. Type a message below to start one.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {state.messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  proposals={state.proposals.filter((p) => p.messageId === message.id && p.status !== "dismissed")}
                  startingProposalId={startingProposalId}
                  onRunProposal={(proposalId) => startProposal.mutate(proposalId)}
                  onDismissProposal={dismissProposal}
                />
              ))}
              {state.streaming && (
                <MessageBubble
                  message={state.streaming}
                  proposals={state.proposals.filter((p) => p.messageId === "streaming" && p.status !== "dismissed")}
                  startingProposalId={startingProposalId}
                  onRunProposal={(proposalId) => startProposal.mutate(proposalId)}
                  onDismissProposal={dismissProposal}
                />
              )}
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
        {showJumpButton && chatId !== null && (
          <button
            type="button"
            onClick={jumpToLatest}
            aria-label="Jump to latest message"
            className="absolute bottom-3 start-1/2 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-border/70 bg-background text-foreground shadow-md hover:bg-muted"
          >
            <ArrowDownIcon className="size-4" />
          </button>
        )}
      </div>

      <div className={cn("shrink-0 border-t border-border/70 p-2", composerClassName)}>
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={handleComposerKeyDown}
          disabled={state.running}
          placeholder="Message the tutor…"
          rows={3}
          className="w-full resize-none rounded-md border border-border bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-muted-foreground disabled:opacity-50"
        />
        <div className="mt-1.5 flex justify-end">
          {state.running ? (
            <Button variant="outline" size="sm" onClick={() => abortChat.mutate()}>
              <SquareIcon /> Stop
            </Button>
          ) : (
            <Button size="sm" onClick={() => void handleSend()} disabled={draft.trim() === "" || createChat.isPending}>
              <SendIcon /> Send
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export default ChatPanel;
