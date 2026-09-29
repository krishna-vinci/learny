// Modeled on Memos' RootLayout.tsx (MIT) — https://github.com/usememos/memos
// Memos' shell composes several contexts (Space, memo filter, memo editor, instance)
// around the resizable sidebar; Studium has none of those, so this keeps only the
// resizable/mobile sidebar shell plus the reader/chat-dock outlet.
import { PanelLeftOpenIcon } from "lucide-react";
import type { CSSProperties } from "react";
import { useRef } from "react";
import { Outlet } from "react-router-dom";
import { useLiveStudiumUpdates } from "@/api/queries";
import AppSidebar, {
  MobileAppHeader,
  MobileAppSidebar,
  MobileSidebarProvider,
  SIDEBAR_COLLAPSED_WIDTH,
  SIDEBAR_WIDTH_VAR,
  SidebarResizeHandle,
  useSidebarCollapsed,
  useSidebarWidth,
} from "@/components/AppSidebar";
import ChatDock from "@/components/ChatDock";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Shown in the fixed sidebar rail in place of the full sidebar when collapsed: just
 * enough to get it back. Modeled on DesktopChatDock's `CollapsedRail`. */
function CollapsedSidebarRail({ onExpand }: { onExpand: () => void }) {
  return (
    <div className="flex h-full w-full flex-col items-center bg-sidebar pt-2">
      <Tooltip>
        <TooltipTrigger
          render={<Button variant="quiet" size="icon-compact" onClick={onExpand} aria-label="Expand sidebar" />}
        >
          <PanelLeftOpenIcon className="size-4" />
        </TooltipTrigger>
        <TooltipContent side="right">Expand sidebar</TooltipContent>
      </Tooltip>
    </div>
  );
}

const RootLayoutContent = () => {
  const shellRef = useRef<HTMLDivElement>(null);
  const { width: sidebarWidth, minWidth, maxWidth, setWidth: setSidebarWidth } = useSidebarWidth();
  const { collapsed, setCollapsed } = useSidebarCollapsed();
  useLiveStudiumUpdates();

  const effectiveSidebarWidth = collapsed ? SIDEBAR_COLLAPSED_WIDTH : sidebarWidth;

  return (
    <div
      ref={shellRef}
      className="min-h-full w-full bg-background"
      style={{ [SIDEBAR_WIDTH_VAR]: `${effectiveSidebarWidth}px` } as CSSProperties}
    >
      <div className="fixed inset-y-0 start-0 z-30 hidden w-(--app-sidebar-width) border-e border-border/70 md:block">
        {collapsed ? (
          <CollapsedSidebarRail onExpand={() => setCollapsed(false)} />
        ) : (
          <>
            <AppSidebar onCollapse={() => setCollapsed(true)} />
            <SidebarResizeHandle
              width={sidebarWidth}
              minWidth={minWidth}
              maxWidth={maxWidth}
              onWidthChange={setSidebarWidth}
              targetRef={shellRef}
            />
          </>
        )}
      </div>
      <MobileAppSidebar />
      <div className={cn("flex min-h-full w-full flex-col md:ps-(--app-sidebar-width)")}>
        <MobileAppHeader />
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1">
            <Outlet />
          </main>
          <ChatDock />
        </div>
      </div>
    </div>
  );
};

const RootLayout = () => (
  <MobileSidebarProvider>
    <RootLayoutContent />
  </MobileSidebarProvider>
);

export default RootLayout;
