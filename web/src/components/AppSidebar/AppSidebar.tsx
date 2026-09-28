// Modeled on Memos' AppSidebar.tsx (MIT) — https://github.com/usememos/memos
// Memos' sidebar switches its whole content by route (timeline/explore/attachments/…)
// and pulls from several contexts (auth, memo editor, instance). Studium's M0 sidebar
// is much smaller: a set switcher, a note list, and disabled placeholders for
// not-yet-built sections.
import {
  ArchiveIcon,
  BookOpenIcon,
  ListChecksIcon,
  MenuIcon,
  NotebookTextIcon,
  SettingsIcon,
  WrenchIcon,
} from "lucide-react";
import { useParams } from "react-router-dom";
import { useNotes } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMobileSidebar } from "./MobileSidebarContext";
import SetSwitcher from "./SetSwitcher";
import SidebarRow from "./SidebarRow";
import SidebarSection, { SIDEBAR_SECTION_STACK_CLASSES } from "./SidebarSection";
import { SIDEBAR_RAIL_CLASSES } from "./sidebar-layout";

const PLACEHOLDER_ROWS = [
  { label: "Library", icon: BookOpenIcon },
  { label: "Cards", icon: NotebookTextIcon },
  { label: "Inbox", icon: ArchiveIcon },
  { label: "Jobs", icon: WrenchIcon },
  { label: "Settings", icon: SettingsIcon },
] as const;

const NotesSidebarContent = ({ set, activeNotePath }: { set: string; activeNotePath?: string }) => {
  const { data: notes = [], isLoading } = useNotes(set);
  const { setMobileOpen } = useMobileSidebar();

  return (
    <div className={SIDEBAR_SECTION_STACK_CLASSES}>
      <SidebarSection label="Notes">
        {isLoading && <div className="px-2 py-1 text-sm text-muted-foreground">Loading…</div>}
        {!isLoading && notes.length === 0 && (
          <div className="px-2 py-1 text-sm text-muted-foreground">No notes yet</div>
        )}
        {notes.map((note) => (
          <SidebarRow
            key={note.path}
            icon={ListChecksIcon}
            label={note.title}
            state={note.path === activeNotePath ? "current" : "idle"}
            onClick={() => setMobileOpen(false)}
          />
        ))}
      </SidebarSection>
      <SidebarSection label="More" ariaLabel="Unimplemented sections">
        {PLACEHOLDER_ROWS.map((row) => (
          <SidebarRow key={row.label} icon={row.icon} label={row.label} disabled />
        ))}
      </SidebarSection>
    </div>
  );
};

const AppSidebar = ({ className }: { className?: string }) => {
  const params = useParams<{ set?: string; "*"?: string }>();
  const set = params.set;
  const activeNotePath = params["*"] ? `notes/${params["*"]}` : undefined;

  return (
    <aside className={cn("flex h-full w-full select-none flex-col bg-sidebar text-sidebar-foreground", className)}>
      <div
        data-sidebar-header
        className={cn("flex h-13 shrink-0 items-center justify-between gap-2", SIDEBAR_RAIL_CLASSES)}
      >
        <SetSwitcher currentSet={set} className="min-w-0" />
      </div>
      <div className="mx-3 mt-2 border-t border-border/70" />
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-2 pb-3 [scrollbar-width:thin]",
          SIDEBAR_RAIL_CLASSES,
        )}
      >
        {set ? (
          <NotesSidebarContent set={set} activeNotePath={activeNotePath} />
        ) : (
          <div className="px-2 py-1 text-sm text-muted-foreground">Select a study set to see its notes.</div>
        )}
      </div>
    </aside>
  );
};

export const MobileAppHeader = () => {
  const { setMobileOpen } = useMobileSidebar();
  const params = useParams<{ set?: string }>();
  return (
    <header className="sticky top-0 z-20 flex h-12 w-full shrink-0 items-center justify-start gap-1 border-b border-border/70 bg-background/90 px-2 backdrop-blur-md md:hidden">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
        data-mobile-navigation-trigger
      >
        <MenuIcon className="size-[18px]" />
      </Button>
      <SetSwitcher currentSet={params.set} className="max-w-[12rem]" />
    </header>
  );
};

export const MobileAppSidebar = () => {
  const { mobileOpen, setMobileOpen } = useMobileSidebar();
  if (!mobileOpen) return null;
  return (
    <div className="fixed inset-0 z-30 md:hidden">
      <button
        type="button"
        aria-label="Close navigation"
        className="absolute inset-0 bg-overlay/50"
        onClick={() => setMobileOpen(false)}
      />
      <div className="absolute inset-y-0 start-0 w-[min(18rem,calc(100vw-2rem))] border-e border-border bg-sidebar shadow-2xl">
        <AppSidebar />
      </div>
    </div>
  );
};

export default AppSidebar;
