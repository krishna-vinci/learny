import type { CourseChapter, CourseView, JobView, NoteSummary } from "@studium/shared";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontalIcon, RefreshCwIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { queryKeys, useCourse } from "@/api/queries";
import { openActivityPanel } from "@/components/Activity/activity-store";
import { ChapterMediaStatus } from "@/components/ChapterMediaStatus";
import ConfirmDialog from "@/components/ConfirmDialog";
import { FirstUseHint } from "@/components/FirstUseHint";
import { RowsSkeleton } from "@/components/ListSkeleton";
import { planHref } from "@/components/Navigation/nav";
import { RewriteChapterDialog } from "@/components/RewriteChapterDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { friendlyMessage } from "@/lib/friendly-errors";
import { toast } from "@/lib/notify";

export function prerequisiteReason(chapter: CourseChapter, chapters: readonly CourseChapter[]): string | null {
  const raw = chapter.prerequisites.trim();
  if (!raw || /^none$/i.test(raw)) return null;
  const labels = raw.split(",").map((s) => s.trim());
  const required = labels.map(Number);
  if (
    labels.some((label) => !/^\d{2,}$/.test(label)) ||
    new Set(required).size !== required.length ||
    required.some((n) => n >= chapter.order || !chapters.some((c) => c.order === n))
  )
    return "Re-plan to clarify this chapter's prerequisites.";
  const missing = required.filter(
    (order) =>
      !chapters.some(
        (c) => c.order === order && (c.state === "drafted" || c.state === "checked" || c.state === "accepted"),
      ),
  );
  return missing.length ? `Draft ${missing.map((n) => String(n).padStart(2, "0")).join(", ")} first.` : null;
}

export function nextDrafts(chapters: readonly CourseChapter[]): CourseChapter[] {
  return [...chapters]
    .sort((a, b) => a.order - b.order)
    .filter((c) => c.state === "planned" && !prerequisiteReason(c, chapters))
    .slice(0, 3);
}

export const STATE_LABELS = {
  planned: "Planned",
  drafting: "Drafting",
  drafted: "Drafted",
  checked: "Checked",
  accepted: "Accepted",
} as const;

/** The chapter state badge, shared with PlanPage.tsx so both pages agree on labels/colours. */
export function ChapterStateBadge({ state }: { state: CourseChapter["state"] }) {
  return (
    <Badge
      variant={state === "checked" || state === "accepted" ? "success" : state === "drafting" ? "tint" : "muted"}
      className={state === "accepted" ? "border-success/40 bg-success/25 font-semibold" : undefined}
    >
      {STATE_LABELS[state]}
    </Badge>
  );
}

export function CoursePlan({ set, jobs, onReplan }: { set: string; jobs: readonly JobView[]; onReplan: () => void }) {
  const course = useCourse(set);
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<Set<number>>(new Set());
  const [rewritePath, setRewritePath] = useState<string | null>(null);
  const [acceptAnyway, setAcceptAnyway] = useState<CourseChapter | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const chapters = course.data?.chapters ?? [];
  const ready = nextDrafts(chapters);
  const shown = expanded ? chapters : chapters.slice(0, 6);
  const noReadyReason = chapters.some((c) => c.state === "planned")
    ? "Draft the prerequisite chapters first."
    : "Every planned chapter has been started.";

  async function accept(chapter: CourseChapter) {
    if (!chapter.path || accepting) return;
    setAccepting(chapter.path);
    try {
      await api.inbox.accept(set, chapter.path);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.course(set) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notes(set) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.inbox(set) }),
      ]);
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.status === 409 ? error.message : friendlyMessage(error, "Failed to accept."),
      );
    } finally {
      setAccepting(null);
    }
  }

  async function draft(rows: readonly CourseChapter[]) {
    setPending(new Set(rows.map((c) => c.order)));
    try {
      for (const chapter of rows) {
        const result = await api.jobs.create({
          kind: "draft-chapter",
          set,
          title: chapter.title,
          brief: chapter.scope,
        });
        queryClient.setQueryData<CourseView>(queryKeys.course(set), (current) =>
          current
            ? {
                ...current,
                chapters: current.chapters.map((c) =>
                  c.order === chapter.order ? { ...c, state: "drafting", jobId: result.jobId } : c,
                ),
              }
            : current,
        );
      }
    } catch (error) {
      toast.error(friendlyMessage(error, "Couldn't start the chapter. Try again."));
    } finally {
      setPending(new Set());
      void queryClient.invalidateQueries({ queryKey: queryKeys.course(set) });
      void queryClient.invalidateQueries({ queryKey: ["jobs"] });
    }
  }

  return (
    <section className="mt-6" aria-labelledby="course-plan-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="course-plan-title" className="text-sm font-semibold text-foreground">
          Course plan
        </h2>
        <div className="flex items-center gap-1">
          <Link
            to={planHref(set)}
            className="flex h-11 min-h-11 items-center px-2 text-sm text-primary underline-offset-2 hover:underline"
          >
            View plan
          </Link>
          <Button variant="quiet" size="sm" className="h-11" onClick={onReplan}>
            Re-plan
          </Button>
        </div>
      </div>
      {course.isLoading ? (
        <RowsSkeleton rows={3} className="mt-2" />
      ) : course.isError ? (
        <p role="alert" className="mt-2 text-sm text-muted-foreground">
          Couldn't load the course plan.{" "}
          <Button variant="quiet" className="h-11" onClick={() => void course.refetch()}>
            Try again
          </Button>
        </p>
      ) : chapters.length === 0 ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Make a plan to see your chapters and draft them at your own pace.
        </p>
      ) : (
        <>
          <FirstUseHint id="course-plan" className="mt-2 [&_button]:min-h-11">
            Tip: you can also ask the tutor to draft the next chapters.
          </FirstUseHint>
          <ol className="mt-2 rounded-md border border-border/70 px-3">
            {shown.map((chapter) => {
              const starting = pending.has(chapter.order);
              const state = starting ? "drafting" : chapter.state;
              const reason = prerequisiteReason(chapter, chapters);
              const job = jobs.find((job) => job.id === chapter.jobId);
              return (
                <li
                  key={chapter.order}
                  className="flex items-start gap-3 border-b border-border/70 py-3 last:border-b-0"
                >
                  <span className="pt-1 text-sm tabular-nums text-muted-foreground">
                    {String(chapter.order).padStart(2, "0")}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      {(state === "drafted" || state === "checked" || state === "accepted") && chapter.path ? (
                        <Link
                          className="min-h-11 min-w-0 flex-1 py-2 text-sm font-medium text-foreground hover:underline"
                          to={`/s/${set}/n/${chapter.path.replace(/^notes\//, "")}`}
                        >
                          {chapter.title}
                        </Link>
                      ) : (
                        <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{chapter.title}</span>
                      )}
                      <ChapterStateBadge state={state} />
                    </div>
                    <ChapterMediaStatus media={chapter.media} />
                    {chapter.evidence && chapter.evidence.total > 0 && (
                      <div className="mt-1 text-xs text-muted-foreground">
                        <span>
                          Evidence: {chapter.evidence.covered}/{chapter.evidence.total} concepts matched
                        </span>
                        <meter
                          className="ml-2 h-2 w-16 align-middle accent-primary"
                          min={0}
                          max={chapter.evidence.total}
                          value={chapter.evidence.covered}
                          aria-label={`Evidence for ${chapter.title}`}
                        />
                        {chapter.evidence.weakest.length > 0 && (
                          <p className="mt-0.5 break-words">Needs support: {chapter.evidence.weakest.join(", ")}</p>
                        )}
                      </div>
                    )}
                    {chapter.scope && (
                      <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground" title={chapter.scope}>
                        {chapter.scope}
                      </p>
                    )}
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      {(state === "drafted" || state === "checked") && chapter.path && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-11"
                          aria-label={`Accept ${chapter.title}`}
                          disabled={accepting !== null}
                          onClick={() => (state === "checked" ? void accept(chapter) : setAcceptAnyway(chapter))}
                        >
                          {accepting === chapter.path ? "Accepting…" : "Accept"}
                        </Button>
                      )}
                      {state === "planned" && (
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-11"
                          aria-label={`Draft ${chapter.title}`}
                          disabled={!!reason || pending.size > 0}
                          onClick={() => void draft([chapter])}
                        >
                          Draft
                        </Button>
                      )}
                      {state === "drafting" && (
                        <Button
                          variant="quiet"
                          size="sm"
                          className="h-11 max-w-full"
                          disabled={!chapter.jobId}
                          onClick={() => chapter.jobId && openActivityPanel(chapter.jobId)}
                        >
                          <Spinner aria-label="Drafting" />
                          <span className="truncate">{job?.progress || (starting ? "Starting…" : "Drafting…")}</span>
                        </Button>
                      )}
                      {(state === "drafted" || state === "checked" || state === "accepted") && chapter.path && (
                        <DropdownMenu>
                          <DropdownMenuTrigger
                            render={<Button variant="quiet" size="icon" className="size-11" />}
                            aria-label={`Actions for ${chapter.title}`}
                          >
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuGroup>
                              <DropdownMenuItem
                                className="min-h-11"
                                onClick={() => setRewritePath(chapter.path ?? null)}
                              >
                                <RefreshCwIcon />
                                Rewrite in teaching voice
                              </DropdownMenuItem>
                            </DropdownMenuGroup>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                      {state === "planned" && reason && <p className="text-xs text-muted-foreground">{reason}</p>}
                    </div>
                  </div>
                </li>
              );
            })}
          </ol>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="h-11"
              disabled={ready.length === 0 || pending.size > 0}
              onClick={() => void draft(ready)}
            >
              {pending.size > 1 ? "Starting…" : "Draft next 3"}
            </Button>
            {chapters.length > 6 && (
              <Button
                variant="quiet"
                size="sm"
                className="h-11"
                aria-expanded={expanded}
                onClick={() => setExpanded((value) => !value)}
              >
                {expanded ? "Show fewer" : `Show all ${chapters.length}`}
              </Button>
            )}
          </div>
          {ready.length === 0 && <p className="mt-1 text-xs text-muted-foreground">{noReadyReason}</p>}
        </>
      )}
      <OtherNotes set={set} notes={course.data?.otherNotes ?? []} />
      <ConfirmDialog
        open={acceptAnyway !== null}
        onOpenChange={(open) => !open && setAcceptAnyway(null)}
        title="Accept unchecked chapter?"
        description="It hasn't been fact-checked yet. Accepting adds the chapter to your notes as it is."
        confirmLabel="Accept anyway"
        onConfirm={() => (acceptAnyway ? accept(acceptAnyway) : undefined)}
      />
      {rewritePath && (
        <RewriteChapterDialog
          set={set}
          path={rewritePath}
          open
          onOpenChange={(open) => !open && setRewritePath(null)}
        />
      )}
    </section>
  );
}

export function OtherNotes({ set, notes }: { set: string; notes: readonly NoteSummary[] }) {
  if (!notes.length) return null;
  return (
    <section className="mt-6" aria-label="Other notes in this set">
      <h2 className="text-sm font-semibold text-foreground">Other notes in this set</h2>
      <ul className="mt-2 rounded-md border border-border/70 px-3">
        {notes.map((note) => (
          <li key={note.path} className="border-b border-border/70 py-2.5 last:border-b-0">
            <Link
              to={`/s/${set}/n/${note.path.replace(/^notes\//, "")}`}
              className="block min-h-11 py-1 text-sm text-foreground hover:underline"
            >
              {note.title}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
