// Chat: a resizable right-hand dock on desktop (lg+), a floating button + full-screen
// sheet on mobile (<lg, see MobileChatDock — the dock used to be `hidden lg:flex`, so
// phones never saw chat at all). `useChatDock` holds the shared state (selected chat,
// streaming reducer) so switching shells across the lg breakpoint never loses it; only
// one shell is ever mounted, picked via `useMediaQuery` rather than CSS hide/show.
import { TooltipProvider } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import DesktopChatDock from "./DesktopChatDock";
import MobileChatDock from "./MobileChatDock";
import { useChatDock } from "./useChatDock";
import { useOpenNote } from "./useOpenNote";

const DESKTOP_QUERY = "(min-width: 1024px)";

function ChatDockWithSet({ set }: { set: string }) {
  const chat = useChatDock(set);
  const isDesktop = useMediaQuery(DESKTOP_QUERY);

  return (
    <TooltipProvider>{isDesktop ? <DesktopChatDock chat={chat} /> : <MobileChatDock chat={chat} />}</TooltipProvider>
  );
}

/** Right-hand chat dock: chat picker, streaming transcript, and composer. */
function ChatDock() {
  const { set } = useOpenNote();

  if (!set) {
    return <div className="hidden w-9 shrink-0 border-s border-border/70 lg:block" />;
  }

  return <ChatDockWithSet set={set} />;
}

export default ChatDock;
