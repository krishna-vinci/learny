import type { TodayItem, TodaySet } from "@studium/shared";
import {
  ArchiveIcon,
  BookOpenIcon,
  ChevronRightIcon,
  ClockIcon,
  LayersIcon,
  RefreshCwIcon,
  SunIcon,
} from "lucide-react";
import { Link } from "react-router-dom";
import { useToday } from "@/api/queries";
import { RowsSkeleton } from "@/components/ListSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { friendlyDetail } from "@/lib/continue-step";
import { cn } from "@/lib/utils";

const icons: Record<TodayItem["kind"], typeof SunIcon> = {
  overdue: ClockIcon,
  inbox: ArchiveIcon,
  "draft-cards": LayersIcon,
  "stale-cards": RefreshCwIcon,
  "next-chapter": BookOpenIcon,
  inactive: SunIcon,
};

function studiedAgo(at: string | null): string {
  if (!at) return "Not studied yet";
  const minutes = Math.max(0, Math.floor((Date.now() - Date.parse(at)) / 60000));
  if (minutes < 1) return "Last studied just now";
  if (minutes < 60) return `Last studied ${minutes}m ago`;
  if (minutes < 1440) return `Last studied ${Math.floor(minutes / 60)}h ago`;
  return `Last studied ${Math.floor(minutes / 1440)}d ago`;
}

/** Only what needs attention: zero counters are noise (docs/UX.md). */
function SetCounters({ set }: { set: TodaySet }) {
  const counters = [
    set.inboxCount > 0 && `${set.inboxCount} to review`,
    set.draftCards > 0 && `${set.draftCards} new ${set.draftCards === 1 ? "card" : "cards"} to check`,
    set.staleCardFiles > 0 &&
      `${set.staleCardFiles} ${set.staleCardFiles === 1 ? "chapter's cards need" : "chapters' cards need"} a refresh`,
    set.runningJobs.length > 0 && `${set.runningJobs.length} running in the background`,
  ].filter((text): text is string => typeof text === "string");
  if (counters.length === 0) return null;
  return (
    <p className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
      {counters.map((text) => (
        <span key={text}>{text}</span>
      ))}
    </p>
  );
}

export default function TodayPage() {
  const { data, isLoading, isError, refetch, isFetching } = useToday();
  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Today</h1>
          <p className="text-sm text-muted-foreground">A little progress, one step at a time.</p>
        </div>
        <Button
          variant="quiet"
          size="icon"
          className="size-11 md:size-8"
          aria-label="Refresh Today"
          disabled={isFetching}
          onClick={() => void refetch()}
        >
          <RefreshCwIcon className={cn("size-4", isFetching && "animate-spin")} />
        </Button>
      </div>
      {isLoading && <RowsSkeleton rows={3} />}
      {isError && (
        <p role="alert" className="text-sm text-destructive">
          Could not load Today. Use Refresh to try again.
        </p>
      )}
      {data && data.sets.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <SunIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing to study yet</EmptyTitle>
            <EmptyDescription>
              Today shows your next step across everything you're learning. Start a study set and it will appear here.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button className="h-11 md:h-9" render={<Link to="/welcome" />} nativeButton={false}>
              Get started
            </Button>
          </EmptyContent>
        </Empty>
      )}
      {data && data.sets.length > 0 && (
        <>
          <section className="flex flex-col gap-3" aria-labelledby="do-next-title">
            <h2 id="do-next-title" className="text-sm font-semibold text-foreground">
              Do next
            </h2>
            {data.doNext.length === 0 && (
              <Empty>
                <EmptyHeader>
                  <EmptyTitle>You're all caught up</EmptyTitle>
                  <EmptyDescription>Nothing needs you right now. Pick a set below to keep going.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            )}
            <ul className="flex flex-col gap-2">
              {data.doNext.slice(0, 7).map((item) => {
                const Icon = icons[item.kind];
                return (
                  <li key={`${item.set}-${item.kind}-${item.href}`}>
                    <Link
                      to={item.href}
                      className="flex min-h-16 items-center gap-3 rounded-lg border border-border/70 bg-card p-3 transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
                    >
                      <Icon
                        className={cn(
                          "size-5 shrink-0 text-muted-foreground",
                          item.kind === "overdue" && "text-destructive",
                        )}
                        aria-hidden="true"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-foreground">{item.title}</p>
                        <p className="text-sm text-muted-foreground">{friendlyDetail(item.detail)}</p>
                      </div>
                      <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
          <section className="flex flex-col gap-3" aria-labelledby="your-sets-title">
            <h2 id="your-sets-title" className="text-sm font-semibold text-foreground">
              Your sets
            </h2>
            <ul className="grid gap-2 sm:grid-cols-2">
              {data.sets.map((set) => (
                <li key={set.slug}>
                  <Link
                    to={`/s/${set.slug}`}
                    className="flex h-full flex-col gap-2 rounded-lg border border-border/70 bg-card p-4 transition-colors hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h3 className="text-sm font-semibold text-foreground">{set.title}</h3>
                      {set.daysLeft !== null && (
                        <Badge variant={set.daysLeft < 0 ? "destructive" : "muted"}>
                          {set.daysLeft < 0
                            ? `${Math.abs(set.daysLeft)}d overdue`
                            : set.daysLeft === 0
                              ? "Due today"
                              : `${set.daysLeft}d left`}
                        </Badge>
                      )}
                    </div>
                    <SetCounters set={set} />
                    <p className="text-xs text-muted-foreground">{studiedAgo(set.lastStudiedAt)}</p>
                    <p className="text-sm text-foreground">
                      {set.nextChapter
                        ? `Next: ${set.nextChapter}`
                        : (set.nextAction ?? "Choose a chapter to continue.")}
                    </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
