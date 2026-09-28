// Right-hand chat dock for lg+ viewports: resizable, collapsible to a thin rail, and
// pinned to the full viewport height via `sticky top-0 h-dvh` — the shell's own height
// chain (RootLayout's `min-h-full` ancestors) doesn't reliably reach 100% of the viewport,
// which is why the composer used to float mid-page instead of sitting at the bottom.
import { PanelRightCloseIcon, PanelRightOpenIcon } from "lucide-react";
import { type CSSProperties, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import ChatPanel from "./ChatPanel";
import ResizeHandle from "./ResizeHandle";
import type { UseChatDockResult } from "./useChatDock";
import { useChatDockCollapsed } from "./useChatDockCollapsed";
import useChatDockWidth, { CHAT_DOCK_WIDTH_VAR } from "./useChatDockWidth";

function CollapsedRail({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="sticky top-0 flex h-dvh w-9 shrink-0 flex-col items-center border-s border-border/70 bg-background pt-2">
      <Tooltip>
        <TooltipTrigger render={<Button variant="quiet" size="icon-compact" onClick={onExpand} />}>
          <PanelRightOpenIcon />
        </TooltipTrigger>
        <TooltipContent side="left">Open chat</TooltipContent>
      </Tooltip>
    </div>
  );
}

function DesktopChatDock({ chat }: { chat: UseChatDockResult }) {
  const { collapsed, setCollapsed } = useChatDockCollapsed();
  const { width, minWidth, maxWidth, setWidth } = useChatDockWidth();
  const panelRef = useRef<HTMLDivElement>(null);

  if (collapsed) return <CollapsedRail onExpand={() => setCollapsed(false)} />;

  return (
    <div
      ref={panelRef}
      style={{ [CHAT_DOCK_WIDTH_VAR]: `${width}px` } as CSSProperties}
      className="sticky top-0 relative h-dvh w-(--chat-dock-width) shrink-0 border-s border-border/70 bg-background"
    >
      <ResizeHandle
        width={width}
        minWidth={minWidth}
        maxWidth={maxWidth}
        onWidthChange={setWidth}
        targetRef={panelRef}
      />
      <ChatPanel
        chat={chat}
        headerEnd={
          <Tooltip>
            <TooltipTrigger render={<Button variant="quiet" size="icon-compact" onClick={() => setCollapsed(true)} />}>
              <PanelRightCloseIcon />
            </TooltipTrigger>
            <TooltipContent side="bottom">Collapse chat</TooltipContent>
          </Tooltip>
        }
      />
    </div>
  );
}

export default DesktopChatDock;
