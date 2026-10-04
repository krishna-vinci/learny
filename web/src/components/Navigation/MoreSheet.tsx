// The phone "More" sheet: everything that is not one of the four main tabs. Sources, cards,
// to-review, activity, settings, set switching, theme and sign out. Uses the shared Dialog
// (bottom sheet on phones), so Escape and the back gesture close it.
import {
  ArchiveIcon,
  BookOpenIcon,
  LayersIcon,
  LibraryBigIcon,
  LogOutIcon,
  MapIcon,
  MonitorIcon,
  MoonIcon,
  PlusIcon,
  SettingsIcon,
  SunIcon,
  WrenchIcon,
} from "lucide-react";
import { type ReactNode, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCurrentUser, useInbox, useJobs, useSets } from "@/api/queries";
import { NewSetDialog } from "@/components/NewSetDialog";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { isActiveJob } from "@/lib/job-transitions";
import { setReadingPrefs, type Theme, useReadingPrefs } from "@/lib/reading-prefs";
import { useSignOut } from "@/pages/useSignOut";
import { cardsHref, planHref, toReviewHref } from "./nav";

function Row({
  icon: Icon,
  label,
  hint,
  count,
  onClick,
}: {
  icon: typeof SunIcon;
  label: string;
  hint?: ReactNode;
  count?: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 text-start text-sm text-foreground hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-ring"
    >
      <Icon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {hint && <span className="shrink-0 text-xs text-muted-foreground">{hint}</span>}
      {!!count && <Badge variant="tint">{count}</Badge>}
    </button>
  );
}

const THEMES: { theme: Theme; label: string; icon: typeof SunIcon }[] = [
  { theme: "system", label: "Auto", icon: MonitorIcon },
  { theme: "light", label: "Light", icon: SunIcon },
  { theme: "dark", label: "Dark", icon: MoonIcon },
];

export function MoreSheet({
  open,
  onOpenChange,
  set,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  set: string | null;
}) {
  const navigate = useNavigate();
  const { user } = useCurrentUser();
  const { data: sets = [] } = useSets();
  const { data: inbox = [] } = useInbox(set ?? undefined);
  const { data: jobs = [] } = useJobs();
  const { theme } = useReadingPrefs();
  const { signOut, signingOut } = useSignOut();
  const [newSetOpen, setNewSetOpen] = useState(false);
  const running = jobs.filter(isActiveJob).length;
  const currentTitle = sets.find((candidate) => candidate.slug === set)?.title;

  const go = (path: string) => {
    onOpenChange(false);
    navigate(path);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent showClose={false} className="gap-1 p-2 pb-[calc(0.5rem+env(safe-area-inset-bottom,0px))]">
          <DialogTitle className="sr-only">More</DialogTitle>
          <DialogDescription className="sr-only">
            Sources, reviews, activity, settings and your account.
          </DialogDescription>
          <Row icon={BookOpenIcon} label="Sources" onClick={() => go("/library")} />
          {set && <Row icon={MapIcon} label="Plan" onClick={() => go(planHref(set))} />}
          {set && <Row icon={LayersIcon} label="Cards" onClick={() => go(cardsHref(set))} />}
          {set && (
            <Row icon={ArchiveIcon} label="To review" count={inbox.length} onClick={() => go(toReviewHref(set))} />
          )}
          <Row icon={WrenchIcon} label="Activity" count={running} onClick={() => go("/jobs")} />
          <div className="my-1 border-t border-border/70" />
          <Row
            icon={LibraryBigIcon}
            label="Study sets"
            hint={currentTitle ? `Now: ${currentTitle}` : undefined}
            onClick={() => go("/sets")}
          />
          <Row
            icon={PlusIcon}
            label="New study set"
            onClick={() => {
              onOpenChange(false);
              setNewSetOpen(true);
            }}
          />
          <div className="my-1 border-t border-border/70" />
          <Row icon={SettingsIcon} label="Settings" onClick={() => go("/settings")} />
          <div className="flex min-h-12 items-center gap-3 px-2 text-sm">
            <SunIcon className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span className="flex-1 text-foreground">Theme</span>
            <div className="flex gap-1">
              {THEMES.map(({ theme: value, label, icon: Icon }) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={theme === value}
                  aria-label={label}
                  onClick={() => setReadingPrefs({ theme: value })}
                  className={
                    theme === value
                      ? "flex size-11 items-center justify-center rounded-md bg-accent text-accent-foreground"
                      : "flex size-11 items-center justify-center rounded-md text-muted-foreground hover:bg-accent/60"
                  }
                >
                  <Icon className="size-4" aria-hidden="true" />
                </button>
              ))}
            </div>
          </div>
          <Row
            icon={LogOutIcon}
            label={signingOut ? "Signing out…" : "Sign out"}
            hint={user?.displayName || user?.username}
            onClick={signOut}
          />
        </DialogContent>
      </Dialog>
      <NewSetDialog open={newSetOpen} onOpenChange={setNewSetOpen} />
    </>
  );
}
