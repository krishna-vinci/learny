// Phone navigation: Today · Notes · Practice · Search · More (docs/UX.md section 2). Always
// visible below `md`, except in full-screen reading. The "More" tab opens `MoreSheet`.
import { BookOpenIcon, MoreHorizontalIcon, SearchIcon, SunIcon, TargetIcon } from "lucide-react";
import { useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { useInbox, useJobs, useSets } from "@/api/queries";
import { openSearch } from "@/components/Search/SearchPalette";
import { useImmersive } from "@/lib/immersive-store";
import { isActiveJob } from "@/lib/job-transitions";
import { cn } from "@/lib/utils";
import { useLastVisitedSet } from "@/pages/useLastVisitedSet";
import { MoreSheet } from "./MoreSheet";
import { practiceHref, setHomeHref } from "./nav";

const TAB_CLASSES =
  "relative flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 text-2xs font-medium transition-colors focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring";

function Tab({
  label,
  icon: Icon,
  active,
  dot,
  to,
  onClick,
}: {
  label: string;
  icon: typeof SunIcon;
  active: boolean;
  dot?: boolean;
  to?: string;
  onClick?: () => void;
}) {
  const className = cn(TAB_CLASSES, active ? "text-primary" : "text-muted-foreground");
  const content = (
    <>
      <span className="relative">
        <Icon className="size-5" strokeWidth={active ? 2.2 : 1.8} aria-hidden="true" />
        {dot && <span className="absolute -end-1 -top-0.5 size-2 rounded-full bg-primary" aria-hidden="true" />}
      </span>
      {label}
      {dot && <span className="sr-only">(needs attention)</span>}
    </>
  );
  if (to) {
    return (
      <Link to={to} className={className} aria-current={active ? "page" : undefined}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" className={className} onClick={onClick} aria-current={active ? "page" : undefined}>
      {content}
    </button>
  );
}

export function BottomTabBar() {
  const immersive = useImmersive();
  const { pathname } = useLocation();
  const lastSet = useLastVisitedSet();
  const { data: sets = [] } = useSets();
  // Before any set was opened, Notes/Practice go to the first set rather than the set list.
  const set = lastSet ?? sets[0]?.slug ?? null;
  const [moreOpen, setMoreOpen] = useState(false);
  const { data: inbox = [] } = useInbox(set ?? undefined);
  const { data: jobs = [] } = useJobs();
  if (immersive) return null;

  const inSet = pathname.startsWith("/s/");
  const practiceActive = !!set && pathname.startsWith(practiceHref(set));
  const notesActive = inSet && !practiceActive && !pathname.endsWith("/inbox");
  const moreActive =
    pathname.startsWith("/library") ||
    pathname.startsWith("/jobs") ||
    pathname.startsWith("/settings") ||
    pathname.startsWith("/sets") ||
    pathname.endsWith("/inbox");
  const needsAttention = inbox.length > 0 || jobs.some(isActiveJob);

  return (
    <>
      <nav
        aria-label="Main"
        className="fixed inset-x-0 bottom-0 z-40 flex border-t border-border/70 bg-background/95 backdrop-blur-md md:hidden"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <Tab label="Today" icon={SunIcon} to="/today" active={pathname === "/today"} />
        <Tab label="Notes" icon={BookOpenIcon} to={setHomeHref(set)} active={notesActive} />
        <Tab label="Practice" icon={TargetIcon} to={set ? practiceHref(set) : "/sets"} active={practiceActive} />
        <Tab label="Search" icon={SearchIcon} onClick={openSearch} active={false} />
        <Tab
          label="More"
          icon={MoreHorizontalIcon}
          onClick={() => setMoreOpen(true)}
          active={moreActive}
          dot={needsAttention}
        />
      </nav>
      <MoreSheet open={moreOpen} onOpenChange={setMoreOpen} set={set} />
    </>
  );
}
