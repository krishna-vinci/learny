// Modeled on Memos' AppSidebar.tsx (MIT) — https://github.com/usememos/memos
// Memos' sidebar switches its whole content by route (timeline/explore/attachments/…)
// and pulls from several contexts (auth, memo editor, instance). Studium's M0 sidebar
// is much smaller: a set switcher, a note list, and disabled placeholders for
// not-yet-built sections.

import type { JobView } from "@studium/shared";
import {
  ArchiveIcon,
  BookOpenIcon,
  ListChecksIcon,
  LogOutIcon,
  MonitorIcon,
  MoonIcon,
  NotebookTextIcon,
  PanelLeftCloseIcon,
  PlusIcon,
  SettingsIcon,
  SunIcon,
  TargetIcon,
  WrenchIcon,
} from "lucide-react";
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useCardFiles, useCurrentUser, useInbox, useJobs, useNotes } from "@/api/queries";
import { DesktopActivityIndicator, MobileActivityIndicator } from "@/components/Activity/ActivityIndicator";
import { openActivityPanel } from "@/components/Activity/activity-store";
import { AddSourceSheet } from "@/components/Library/AddSourceSheet";
import { cardsHref, pageTitleFor, practiceHref, toReviewHref } from "@/components/Navigation/nav";
import { NewChapterSheet } from "@/components/NewChapterSheet";
import { NewNoteDialog } from "@/components/NewNoteDialog";
import { SearchButton } from "@/components/Search/SearchPalette";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { isActiveJob } from "@/lib/job-transitions";
import { setReadingPrefs, type Theme, useReadingPrefs } from "@/lib/reading-prefs";
import { cn } from "@/lib/utils";
import { useLastVisitedSet } from "@/pages/useLastVisitedSet";
import { useSignOut } from "@/pages/useSignOut";
import { useMobileSidebar } from "./MobileSidebarContext";
import SetSwitcher from "./SetSwitcher";
import SidebarRow, { SIDEBAR_ROW_CLASSES } from "./SidebarRow";
import SidebarSection, { SIDEBAR_SECTION_STACK_CLASSES } from "./SidebarSection";
import { SIDEBAR_LEADING_SLOT_CLASSES, SIDEBAR_RAIL_CLASSES } from "./sidebar-layout";

/** A3: one greyed "Drafting…" row per queued/running draft-chapter job in this set. */
function DraftingSidebarRow({ job }: { job: JobView }) {
  return (
    <button
      type="button"
      onClick={() => openActivityPanel(job.id)}
      aria-label={`Drafting ${job.title}: ${job.progress || "starting"}`}
      className={cn(SIDEBAR_ROW_CLASSES, "text-muted-foreground/80 hover:bg-sidebar-accent/65 hover:text-foreground")}
    >
      <span className={SIDEBAR_LEADING_SLOT_CLASSES} aria-hidden="true">
        <Spinner className="opacity-70" aria-label="Drafting" />
      </span>
      <span className="min-w-0 flex-1 truncate text-start">{job.title}</span>
      <span className="max-w-[9rem] shrink-0 truncate text-2xs text-muted-foreground/70">
        {job.progress || "Drafting…"}
      </span>
    </button>
  );
}

const NotesSection = ({ set, activeNotePath }: { set: string; activeNotePath?: string }) => {
  const { data: notes = [], isLoading } = useNotes(set);
  const { data: jobs = [] } = useJobs(set);
  const draftingJobs = jobs.filter((job) => job.kind === "draft-chapter" && job.set === set && isActiveJob(job));
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
        {isLoading && (
          <div className="flex flex-col gap-1.5 px-2 py-1" role="status" aria-label="Loading notes">
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-5/6" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        )}
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
        {draftingJobs.map((job) => (
          <DraftingSidebarRow key={job.id} job={job} />
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

// "Study": Today plus the current set's Practice, Cards and To review. Rows that need a set are left out
// (not disabled) when no set is selected.
const StudySection = ({ set }: { set?: string }) => {
  const { setMobileOpen } = useMobileSidebar();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: inboxItems = [] } = useInbox(set);
  const { data: cardFiles = [] } = useCardFiles(set);
  const draftCardCount = cardFiles.reduce((total, file) => total + (file.counts.draft ?? 0), 0);
  const practicePath = set ? practiceHref(set) : "";
  const cardsPath = set ? cardsHref(set) : "";
  const practiceActive = !!set && location.pathname.startsWith(practicePath);
  const cardsActive = !!set && (location.pathname === cardsPath || location.pathname.startsWith(`${cardsPath}/`));
  const goTo = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };

  return (
    <SidebarSection label="Study" ariaLabel="Study">
      <SidebarRow
        icon={SunIcon}
        label="Today"
        state={location.pathname === "/today" ? "current" : "idle"}
        onClick={() => goTo("/today")}
      />
      {set && (
        <>
          <SidebarRow
            icon={TargetIcon}
            label="Practice"
            state={practiceActive ? "current" : "idle"}
            onClick={() => goTo(practicePath)}
          />
          <SidebarRow
            icon={NotebookTextIcon}
            label="Cards"
            count={draftCardCount}
            state={cardsActive ? "current" : "idle"}
            onClick={() => goTo(cardsPath)}
          />
          <SidebarRow
            icon={ArchiveIcon}
            label="To review"
            count={inboxItems.length}
            state={location.pathname === toReviewHref(set) ? "current" : "idle"}
            onClick={() => goTo(toReviewHref(set))}
          />
        </>
      )}
    </SidebarSection>
  );
};

// "Library": the shared source library, with the Add source action. Shown with or without a set.
const LibrarySection = ({ set }: { set?: string }) => {
  const { setMobileOpen } = useMobileSidebar();
  const navigate = useNavigate();
  const location = useLocation();
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const libraryActive = location.pathname === "/library" || location.pathname.startsWith("/library/");

  return (
    <>
      <SidebarSection
        label="Library"
        ariaLabel="Library"
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
          icon={BookOpenIcon}
          label="Sources"
          state={libraryActive ? "current" : "idle"}
          onClick={() => {
            navigate("/library");
            setMobileOpen(false);
          }}
        />
      </SidebarSection>
      <AddSourceSheet open={addSourceOpen} onOpenChange={setAddSourceOpen} defaultSet={set ?? null} />
    </>
  );
};

// Activity and Settings sit at the bottom of the sidebar, outside the scrolling sections.
const FooterNav = () => {
  const { setMobileOpen } = useMobileSidebar();
  const navigate = useNavigate();
  const location = useLocation();
  const { data: jobs = [] } = useJobs();
  const runningJobCount = jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const goTo = (path: string) => {
    navigate(path);
    setMobileOpen(false);
  };
  return (
    <div className={cn("flex flex-col gap-0.5 border-t border-border/70 py-2", SIDEBAR_RAIL_CLASSES)}>
      <SidebarRow
        icon={WrenchIcon}
        label="Activity"
        count={runningJobCount}
        state={location.pathname === "/jobs" ? "current" : "idle"}
        onClick={() => goTo("/jobs")}
      />
      <SidebarRow
        icon={SettingsIcon}
        label="Settings"
        state={location.pathname === "/settings" || location.pathname.startsWith("/settings/") ? "current" : "idle"}
        onClick={() => goTo("/settings")}
      />
    </div>
  );
};

// Slice C quick toggle: System → Light → Dark → System…, skipping Sepia/Black (those stay
// Settings → Appearance-only, since a one-tap cycle through all 5 would be tedious).
const THEME_CYCLE = ["system", "light", "dark"] as const satisfies readonly Theme[];
const THEME_TOGGLE_META: Record<(typeof THEME_CYCLE)[number], { icon: typeof MonitorIcon; label: string }> = {
  system: { icon: MonitorIcon, label: "System" },
  light: { icon: SunIcon, label: "Light" },
  dark: { icon: MoonIcon, label: "Dark" },
};

function ThemeToggleButton() {
  const { theme } = useReadingPrefs();
  // A theme outside the 3-step cycle (Sepia/Black, picked from Settings) still needs a
  // sensible next stop — from either, the cycle continues at "system".
  const current = (THEME_CYCLE as readonly Theme[]).includes(theme)
    ? (theme as (typeof THEME_CYCLE)[number])
    : "system";
  const meta = THEME_TOGGLE_META[current];
  const Icon = meta.icon;

  const cycleTheme = () => {
    const index = THEME_CYCLE.indexOf(current);
    setReadingPrefs({ theme: THEME_CYCLE[(index + 1) % THEME_CYCLE.length] });
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant="quiet"
            size="icon-compact"
            onClick={cycleTheme}
            aria-label={`Theme: ${meta.label}. Click to switch.`}
            className="shrink-0"
          />
        }
      >
        <Icon className="size-4" />
      </TooltipTrigger>
      <TooltipContent side="right">Theme: {meta.label}</TooltipContent>
    </Tooltip>
  );
}

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
      <ThemeToggleButton />
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
  const { setMobileOpen } = useMobileSidebar();
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
        <span className="flex shrink-0 items-center gap-1">
          <DesktopActivityIndicator />
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
        </span>
      </div>
      <div className={SIDEBAR_RAIL_CLASSES}>
        <SearchButton onOpen={() => setMobileOpen(false)} />
      </div>
      <div className="mx-3 mt-2 border-t border-border/70" />
      <div
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overflow-x-hidden pt-2 pb-3 [scrollbar-width:thin]",
          SIDEBAR_RAIL_CLASSES,
        )}
      >
        <div className={SIDEBAR_SECTION_STACK_CLASSES}>
          <StudySection set={set} />
          {set ? (
            <NotesSection set={set} activeNotePath={activeNotePath} />
          ) : (
            <div className="px-2 py-1 text-sm text-muted-foreground">Pick or create a study set to see its notes.</div>
          )}
          <LibrarySection set={set} />
        </div>
      </div>
      <FooterNav />
      <UserFooter />
    </aside>
  );
};

/** Phone top bar: the set switcher inside a set, the page title elsewhere. Navigation itself is the
 * bottom tab bar (`Navigation/BottomTabBar`), so there is no menu button. */
export const MobileAppHeader = () => {
  const params = useParams<{ set?: string }>();
  const { pathname } = useLocation();
  const lastVisitedSet = useLastVisitedSet();
  const title = pageTitleFor(pathname);
  return (
    <header
      className="sticky top-0 z-20 flex h-12 w-full shrink-0 items-center justify-start gap-1 border-b border-border/70 bg-background/90 px-3 backdrop-blur-md md:hidden"
      style={{ paddingTop: "env(safe-area-inset-top)", height: "calc(3rem + env(safe-area-inset-top))" }}
    >
      {params.set || !title ? (
        <SetSwitcher currentSet={params.set ?? lastVisitedSet ?? undefined} className="max-w-[16rem]" />
      ) : (
        <h1 className="truncate text-[15px] font-semibold text-foreground">{title}</h1>
      )}
      <span className="ms-auto flex items-center gap-1">
        <MobileActivityIndicator />
      </span>
    </header>
  );
};

export default AppSidebar;
