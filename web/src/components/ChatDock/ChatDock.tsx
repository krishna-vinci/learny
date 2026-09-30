// Chat: a resizable right-hand dock on desktop (lg+), a floating button + full-screen
// sheet on mobile (<lg, see MobileChatDock — the dock used to be `hidden lg:flex`, so
// phones never saw chat at all). `useChatDock` holds the shared state (selected chat,
// streaming reducer) so switching shells across the lg breakpoint never loses it; only
// one shell is ever mounted, picked via `useMediaQuery` rather than CSS hide/show.
import { lazy, Suspense } from "react";
import { useImmersive } from "@/lib/immersive-store";
import { useChatDockCollapsed } from "./useChatDockCollapsed";
import useChatDockWidth from "./useChatDockWidth";
import { useOpenNote } from "./useOpenNote";

// Code-split: the chat UI (markdown, streaming reducer, panels) loads when a set is opened.
const ChatDockWithSet = lazy(() => import("./ChatDockWithSet"));

/** Holds the dock's space while its code loads, so the page doesn't jump when it arrives. */
function ChatDockPlaceholder() {
  const { collapsed } = useChatDockCollapsed();
  const { width } = useChatDockWidth();
  return (
    <div
      className="hidden shrink-0 border-s border-border/70 lg:block"
      style={{ width: collapsed ? "2.25rem" : `${width}px` }}
    />
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
        <Suspense fallback={<ChatDockPlaceholder />}>
          <ChatDockWithSet key={set} set={set} />
        </Suspense>
      ) : (
        <div className="hidden w-9 shrink-0 border-s border-border/70 lg:block" />
      )}
    </div>
  );
}

export default ChatDock;
