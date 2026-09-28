// The chat dock's presentational core: header (picker/new-chat/`headerEnd` slot), the
// scrolling transcript, and the composer. Used as-is by both the desktop dock (lg+) and
// the mobile full-screen sheet — see DesktopChatDock.tsx / MobileChatDock.tsx.
import { PlusIcon, SendIcon, SquareIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import ChatPicker from "./ChatPicker";
import MessageMarkdown from "./MessageMarkdown";
import type { ChatDockState } from "./reducer";
import ToolCallChip from "./ToolCallChip";
import type { UseChatDockResult } from "./useChatDock";

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
  } = chat;

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
              />
            }
          >
            <PlusIcon />
          </TooltipTrigger>
          <TooltipContent side="bottom">New chat</TooltipContent>
        </Tooltip>
        {headerEnd && <div className="ms-auto flex items-center">{headerEnd}</div>}
      </div>

      <ScrollArea className="min-h-0 flex-1 px-3 py-3">
        {chatId === null ? (
          <p className="p-2 text-sm text-muted-foreground">No chats yet — start one.</p>
        ) : (
          <div className="flex flex-col gap-3">
            {state.messages.map((message) => (
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

      <div className={cn("shrink-0 border-t border-border/70 p-2", composerClassName)}>
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

export default ChatPanel;
