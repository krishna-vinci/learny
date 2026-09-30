// Chat: a resizable right-hand dock on desktop (lg+), a floating button + full-screen
// sheet on mobile (<lg, see MobileChatDock — the dock used to be `hidden lg:flex`, so
// phones never saw chat at all). `useChatDock` holds the shared state (selected chat,
// streaming reducer) so switching shells across the lg breakpoint never loses it; only
// one shell is ever mounted, picked via `useMediaQuery` rather than CSS hide/show.
import { TooltipProvider } from "@/components/ui/tooltip";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { useImmersive } from "@/lib/immersive-store";
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
  const immersive = useImmersive();

  // B2: hidden, not unmounted, while the immersive reader is up — the wrapper is
  // `display: contents` otherwise, so the layout is exactly as if it weren't there.
  return (
    <div className={immersive ? "hidden" : "contents"}>
      {set ? (
        <ChatDockWithSet key={set} set={set} />
      ) : (
        <div className="hidden w-9 shrink-0 border-s border-border/70 lg:block" />
      )}
    </div>
  );
}

export default ChatDock;
