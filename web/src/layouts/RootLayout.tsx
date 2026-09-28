// Modeled on Memos' RootLayout.tsx (MIT) — https://github.com/usememos/memos
// Memos' shell composes several contexts (Space, memo filter, memo editor, instance)
// around the resizable sidebar; Studium has none of those, so this keeps only the
// resizable/mobile sidebar shell plus the reader/chat-dock outlet.
import type { CSSProperties } from "react";
import { useRef } from "react";
import { Outlet } from "react-router-dom";
import { useLiveStudiumUpdates } from "@/api/queries";
import AppSidebar, {
  MobileAppHeader,
  MobileAppSidebar,
  MobileSidebarProvider,
  SIDEBAR_WIDTH_VAR,
  SidebarResizeHandle,
  useSidebarWidth,
} from "@/components/AppSidebar";
import { cn } from "@/lib/utils";

/** Filled in by T9; kept as an empty slot so the shell renders without it. */
const ChatDockSlot = () => (
  <div data-chat-dock-slot className="hidden w-80 shrink-0 border-s border-border/70 lg:block" />
);

const RootLayoutContent = () => {
  const shellRef = useRef<HTMLDivElement>(null);
  const { width: sidebarWidth, minWidth, maxWidth, setWidth: setSidebarWidth } = useSidebarWidth();
  useLiveStudiumUpdates();

  return (
    <div
      ref={shellRef}
      className="min-h-full w-full bg-background"
      style={{ [SIDEBAR_WIDTH_VAR]: `${sidebarWidth}px` } as CSSProperties}
    >
      <div className="fixed inset-y-0 start-0 z-30 hidden w-(--app-sidebar-width) border-e border-border/70 md:block">
        <AppSidebar />
        <SidebarResizeHandle
          width={sidebarWidth}
          minWidth={minWidth}
          maxWidth={maxWidth}
          onWidthChange={setSidebarWidth}
          targetRef={shellRef}
        />
      </div>
      <MobileAppSidebar />
      <div className={cn("flex min-h-full w-full flex-col md:ps-(--app-sidebar-width)")}>
        <MobileAppHeader />
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1">
            <Outlet />
          </main>
          <ChatDockSlot />
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
