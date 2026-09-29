// Modeled on Memos' AppSidebar.tsx (MIT) — https://github.com/usememos/memos
// Memos' sidebar switches its whole content by route (timeline/explore/attachments/…)
// and pulls from several contexts (auth, memo editor, instance). Studium's M0 sidebar
// is much smaller: a set switcher, a note list, and disabled placeholders for
// not-yet-built sections.
import {
  ArchiveIcon,
  BookOpenIcon,
  LibraryBigIcon,
  ListChecksIcon,
  LogOutIcon,
  MenuIcon,
  NotebookTextIcon,
  PanelLeftCloseIcon,
  PlusIcon,
  SettingsIcon,
  WrenchIcon,
} from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useCardFiles, useCurrentUser, useInbox, useJobs, useNotes } from "@/api/queries";
import { AddSourceSheet } from "@/components/Library/AddSourceSheet";
import { NewChapterSheet } from "@/components/NewChapterSheet";
import { NewNoteDialog } from "@/components/NewNoteDialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { useLastVisitedSet } from "@/pages/useLastVisitedSet";
import { useSignOut } from "@/pages/useSignOut";
import { useMobileSidebar } from "./MobileSidebarContext";
import SetSwitcher from "./SetSwitcher";
import SidebarRow from "./SidebarRow";
import SidebarSection, { SIDEBAR_SECTION_STACK_CLASSES } from "./SidebarSection";
import { SIDEBAR_RAIL_CLASSES } from "./sidebar-layout";

const NotesSection = ({ set, activeNotePath }: { set: string; activeNotePath?: string }) => {
  const { data: notes = [], isLoading } = useNotes(set);
  const { setMobileOpen } = useMobileSidebar();
  const navigate = useNavigate();
  const [newChapterOpen, setNewChapterOpen] = useState(false);
  const [newNoteOpen, setNewNoteOpen] = useState(false);

  return (
    <>
      <SidebarSection
        label="Notes"
        action={
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Add note"
              title="Add note"
              className={buttonVariants({ variant: "quiet", size: "icon-compact" })}
            >
              <PlusIcon className="size-3.5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setNewChapterOpen(true)}>New chapter</DropdownMenuItem>
              <DropdownMenuItem onClick={() => setNewNoteOpen(true)}>Write a note</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        }
      >
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
            onClick={() => {
              navigate(`/s/${set}/n/${note.path.replace(/^notes\//, "")}`);
              setMobileOpen(false);
            }}
          />
        ))}
      </SidebarSection>
      {newChapterOpen && (
        <NewChapterSheet
          set={set}
          onClose={() => {
            setNewChapterOpen(false);
            setMobileOpen(false);
          }}
        />
      )}
      <NewNoteDialog
        set={set}
        open={newNoteOpen}
        onOpenChange={(open) => {
          setNewNoteOpen(open);
          if (!open) setMobileOpen(false);
        }}
      />
    </>
  );
};

// Rendered regardless of whether a study set is selected, so the Library link (and its
// "Add source" action) works from `/library` too, not just from under `/s/:set`.
const MoreSection = ({ set }: { set?: string }) => {
  const { setMobileOpen } = useMobileSidebar();
  const navigate = useNavigate();
  const location = useLocation();
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const libraryActive = location.pathname === "/library" || location.pathname.startsWith("/library/");
  const { data: jobs = [] } = useJobs();
  const runningJobCount = jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const { data: inboxItems = [] } = useInbox(set);
  const { data: cardFiles = [] } = useCardFiles(set);
  const draftCardCount = cardFiles.reduce((total, file) => total + (file.counts.draft ?? 0), 0);
  const cardsActive =
    !!set && (location.pathname === `/s/${set}/cards` || location.pathname.startsWith(`/s/${set}/cards/`));
  const goTo = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  return (
    <>
      <SidebarSection
        label="More"
        ariaLabel="Library and other sections"
        action={
          <Button
            variant="quiet"
            size="icon-compact"
            onClick={() => setAddSourceOpen(true)}
            aria-label="Add source"
            title="Add source"
          >
            <PlusIcon className="size-3.5" />
          </Button>
        }
      >
        <SidebarRow
          icon={LibraryBigIcon}
          label="All study sets"
          state={location.pathname === "/sets" ? "current" : "idle"}
          onClick={() => goTo("/sets")}
        />
        <SidebarRow
          icon={BookOpenIcon}
          label="Library"
          state={libraryActive ? "current" : "idle"}
          onClick={() => {
            navigate("/library");
            setMobileOpen(false);
          }}
        />
        <SidebarRow
          icon={ArchiveIcon}
          label="Inbox"
          count={inboxItems.length}
          disabled={!set}
          state={set && location.pathname === `/s/${set}/inbox` ? "current" : "idle"}
          onClick={set ? () => goTo(`/s/${set}/inbox`) : undefined}
        />
        <SidebarRow
          icon={WrenchIcon}
          label="Jobs"
          count={runningJobCount}
          state={location.pathname === "/jobs" ? "current" : "idle"}
          onClick={() => goTo("/jobs")}
        />
        <SidebarRow
          icon={NotebookTextIcon}
          label="Cards"
          count={draftCardCount}
          disabled={!set}
          state={cardsActive ? "current" : "idle"}
          onClick={set ? () => goTo(`/s/${set}/cards`) : undefined}
        />
        <SidebarRow
          icon={SettingsIcon}
          label="Settings"
          state={location.pathname === "/settings" || location.pathname.startsWith("/settings/") ? "current" : "idle"}
          onClick={() => {
            navigate("/settings");
            setMobileOpen(false);
          }}
        />
      </SidebarSection>
      <AddSourceSheet open={addSourceOpen} onOpenChange={setAddSourceOpen} defaultSet={set ?? null} />
    </>
  );
};

// Signed-in user's name/avatar, pinned to the bottom of the sidebar next to Sign out —
// outside the scrollable section list so it's always visible.
const UserFooter = () => {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const { setMobileOpen } = useMobileSidebar();
  const { signOut, signingOut } = useSignOut();

  return (
    <div className={cn("flex h-13 shrink-0 items-center gap-2 border-t border-border/70", SIDEBAR_RAIL_CLASSES)}>
      <button
        type="button"
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1.5 text-start hover:bg-accent/60"
        onClick={() => {
          navigate("/settings/my-account");
          setMobileOpen(false);
        }}
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent text-xs font-semibold text-accent-foreground">
          {(user?.displayName || user?.username || "?").slice(0, 1).toUpperCase()}
        </span>
        <span className="min-w-0 truncate text-sm text-foreground">{user?.displayName || user?.username || "…"}</span>
      </button>
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="quiet"
              size="icon-compact"
              onClick={signOut}
              disabled={signingOut}
              aria-label="Sign out"
              className="shrink-0"
            />
          }
        >
          <LogOutIcon className="size-4" />
        </TooltipTrigger>
        <TooltipContent side="right">{signingOut ? "Signing out…" : "Sign out"}</TooltipContent>
      </Tooltip>
    </div>
  );
};

const AppSidebar = ({ className, onCollapse }: { className?: string; onCollapse?: () => void }) => {
  const params = useParams<{ set?: string; "*"?: string }>();
  // Outside `/s/:set` (library, jobs, settings), everything in the sidebar — the switcher
  // label, the notes list, and the Inbox/Cards links — falls back to the last visited set
  // instead of going blank, so the sidebar stays useful while browsing those pages.
  const lastVisitedSet = useLastVisitedSet();
  const set = params.set ?? lastVisitedSet ?? undefined;
  const activeNotePath = params["*"] ? `notes/${params["*"]}` : undefined;

  return (
    <aside className={cn("flex h-full w-full select-none flex-col bg-sidebar text-sidebar-foreground", className)}>
      <div
        data-sidebar-header
        className={cn("flex h-13 shrink-0 items-center justify-between gap-2", SIDEBAR_RAIL_CLASSES)}
      >
        <SetSwitcher currentSet={set} className="min-w-0 flex-1" />
        {onCollapse && (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="quiet"
                  size="icon-compact"
                  onClick={onCollapse}
                  aria-label="Collapse sidebar"
                  className="shrink-0"
                />
              }
            >
              <PanelLeftCloseIcon className="size-4" />
            </TooltipTrigger>
            <TooltipContent side="right">Collapse sidebar</TooltipContent>
          </Tooltip>
        )}
      </div>
      <div className="mx-3 mt-2 border-t border-border/70" />
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-2 pb-3 [scrollbar-width:thin]",
          SIDEBAR_RAIL_CLASSES,
        )}
      >
        <div className={SIDEBAR_SECTION_STACK_CLASSES}>
          {set ? (
            <NotesSection set={set} activeNotePath={activeNotePath} />
          ) : (
            <div className="px-2 py-1 text-sm text-muted-foreground">Select a study set to see its notes.</div>
          )}
          <MoreSection set={set} />
        </div>
      </div>
      <UserFooter />
    </aside>
  );
};

export const MobileAppHeader = () => {
  const { setMobileOpen } = useMobileSidebar();
  const params = useParams<{ set?: string }>();
  const lastVisitedSet = useLastVisitedSet();
  return (
    <header
      className="sticky top-0 z-20 flex h-12 w-full shrink-0 items-center justify-start gap-1 border-b border-border/70 bg-background/90 px-2 backdrop-blur-md md:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)", height: "calc(3rem + env(safe-area-inset-top))" }}
    >
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setMobileOpen(true)}
        aria-label="Open navigation"
        data-mobile-navigation-trigger
      >
        <MenuIcon className="size-[18px]" />
      </Button>
      <SetSwitcher currentSet={params.set ?? lastVisitedSet ?? undefined} className="max-w-[12rem]" />
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
