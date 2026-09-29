import type { ChatSummary } from "@studium/shared";
import { ChevronDownIcon } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

interface ChatPickerProps {
  chats: ChatSummary[];
  activeChatId: string | null;
  onSelect: (chatId: string) => void;
}

function ChatPicker({ chats, activeChatId, onSelect }: ChatPickerProps) {
  const active = chats.find((chat) => chat.id === activeChatId);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className={cn(buttonVariants({ variant: "quiet", size: "sm" }), "min-w-0 max-w-40")}>
        <span className="truncate">{active?.title || "Untitled chat"}</span>
        <ChevronDownIcon className="size-3.5 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" size="sm">
        {chats.length === 0 ? (
          <div className="px-2 py-1.5 text-ui text-muted-foreground">No chats yet</div>
        ) : (
          chats.map((chat) => (
            <DropdownMenuItem key={chat.id} onClick={() => onSelect(chat.id)}>
              <span className="truncate">{chat.title || "Untitled chat"}</span>
            </DropdownMenuItem>
          ))
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default ChatPicker;
