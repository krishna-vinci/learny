// Mobile (<lg) chat: a floating round button that opens a full-screen sheet over the
// reader. Shares the same `useChatDock` state as the desktop dock (lifted into ChatDock.tsx)
// so opening/closing the sheet, or resizing across the lg breakpoint, never loses the
// selected chat or an in-flight stream.
import { MessageSquareIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import ChatPanel from "./ChatPanel";
import { OPEN_CHAT_DOCK_EVENT } from "./openChatDock";
import type { UseChatDockResult } from "./useChatDock";

function MobileChatDock({ chat }: { chat: UseChatDockResult }) {
  const [open, setOpen] = useState(false);

  // Lets pages outside the dock (SetHomePage's "Ask tutor") open the same sheet — see
  // openChatDock.ts.
  useEffect(() => {
    const listener = () => setOpen(true);
    window.addEventListener(OPEN_CHAT_DOCK_EVENT, listener);
    return () => window.removeEventListener(OPEN_CHAT_DOCK_EVENT, listener);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open chat"
        className="fixed end-4 z-40 flex size-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-float active:scale-95"
        style={{ bottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
      >
        <MessageSquareIcon className="size-6" />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex h-[100dvh] flex-col bg-background">
          <ChatPanel
            chat={chat}
            headerEnd={
              <Button variant="quiet" size="icon-compact" onClick={() => setOpen(false)} aria-label="Close chat">
                <XIcon />
              </Button>
            }
            composerClassName="pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)]"
          />
        </div>
      )}
    </>
  );
}

export default MobileChatDock;
