// `/s/:set/plan` — the full plan the owner asked for ("I couldn't see the plan that is
// already made at all"): PLAN.md's header facts and prose body, the sources it cites, and
// every curriculum chapter with its scope/prerequisites/state. `CourseChapter` (from
// `GET /api/sets/:set/course`) already carries scope and prerequisites straight from
// curriculum.md (`server/src/course/build.ts`), so there's no separate curriculum.md fetch.
import { ClipboardListIcon, RefreshCwIcon, SparklesIcon } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useCourse, useNoteFile, useSetSources, useSets } from "@/api/queries";
import { ChapterMediaStatus } from "@/components/ChapterMediaStatus";
import { ChapterStateBadge, OtherNotes } from "@/components/CoursePlan";
import { ChapterPlanMenu, useCurriculumEditing } from "@/components/CurriculumEditing";
import { RowsSkeleton } from "@/components/ListSkeleton";
import { NoteEditor } from "@/components/NoteEditor/NoteEditor";
import { PlanSetSheet } from "@/components/PlanSetSheet";
import { MarkdownView } from "@/components/Reader/MarkdownView";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

function capitalize(value: string): string {
  return value.length ? value[0]?.toUpperCase() + value.slice(1) : value;
}

function formatDeadline(deadline: string | null | undefined): string {
  if (!deadline) return "no deadline";
  const date = new Date(deadline);
  return Number.isNaN(date.getTime())
    ? deadline
    : date.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export default function PlanPage() {
  const params = useParams<{ set: string }>();
  const set = params.set as string;
  const { data: sets } = useSets();
  const { data: plan, isLoading: planLoading } = useNoteFile(set, "PLAN.md");
  const course = useCourse(set);
  const sourcesQuery = useSetSources(set);
  const [planOpen, setPlanOpen] = useState(false);
  const [changing, setChanging] = useState(false);
  const [editingPlan, setEditingPlan] = useState(false);
  const editor = useCurriculumEditing(set);

  const summary = sets?.find((s) => s.slug === set);
  const chapters = course.data?.chapters ?? [];
  const sources = sourcesQuery.data ?? [];
  const subject = typeof plan?.frontmatter.subject === "string" ? plan.frontmatter.subject : null;
  const body = plan?.body ?? "";
  const bodyEmpty = !body.trim();

  if (editingPlan && plan)
    return <NoteEditor set={set} path="PLAN.md" file={plan} onDone={() => setEditingPlan(false)} />;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Plan</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{summary?.title ?? set}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {plan && (
            <Button variant="outline" size="sm" className="h-11" onClick={() => setEditingPlan(true)}>
              Edit plan text
            </Button>
          )}
          {!bodyEmpty && (
            <Button variant="outline" size="sm" className="h-11" onClick={() => setChanging(true)}>
              Change with agent
            </Button>
          )}
          <Button variant="quiet" size="sm" className="h-11" onClick={() => setPlanOpen(true)}>
            <RefreshCwIcon aria-hidden="true" />
            Re-plan
          </Button>
        </div>
      </div>

      {!planLoading && (
        <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground" data-testid="plan-facts">
          <span>Level {summary?.level ?? "not set"}</span>
          <span>{formatDeadline(summary?.deadline)}</span>
          {subject && <span>{capitalize(subject)}</span>}
          {summary?.status && <span>{capitalize(summary.status)}</span>}
        </p>
      )}

      {planLoading ? (
        <RowsSkeleton rows={4} className="mt-6" />
      ) : bodyEmpty ? (
        <Empty className="mt-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardListIcon aria-hidden="true" />
            </EmptyMedia>
            <EmptyTitle>No plan yet</EmptyTitle>
            <EmptyDescription>
              Ask the agent to make a plan for this set: a goal, scope, sources and chapters.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button className="h-11 w-full" onClick={() => setPlanOpen(true)}>
              <SparklesIcon aria-hidden="true" />
              Plan with agent
            </Button>
          </EmptyContent>
        </Empty>
      ) : (
        <>
          <section className="mt-6" aria-label="Plan">
            <MarkdownView content={body} />
          </section>

          <section className="mt-6" aria-labelledby="plan-sources-title">
            <h2 id="plan-sources-title" className="text-sm font-semibold text-foreground">
              Sources in this plan
            </h2>
            {sourcesQuery.isLoading ? (
              <RowsSkeleton rows={2} className="mt-2" />
            ) : sources.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">No sources linked yet.</p>
            ) : (
              <ul className="mt-2 rounded-md border border-border/70 px-3">
                {sources.map((source) => (
                  <li key={source.id} className="border-b border-border/70 py-2.5 last:border-b-0">
                    <Link
                      to={`/library/${source.id}`}
                      className="block min-h-11 py-1 text-sm text-foreground hover:underline"
                    >
                      {source.title}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      <section className="mt-6" aria-labelledby="plan-chapters-title">
        <div className="flex items-center justify-between gap-2">
          <h2 id="plan-chapters-title" className="text-sm font-semibold text-foreground">
            Chapters
          </h2>
          <Button variant="outline" className="h-11" onClick={() => void editor.action("insert", null)}>
            Add chapter
          </Button>
        </div>
        {course.isLoading ? (
          <RowsSkeleton rows={3} className="mt-2" />
        ) : chapters.length === 0 ? (
          <p className="mt-2 text-sm text-muted-foreground">No chapters planned yet.</p>
        ) : (
          <ol className="mt-2 rounded-md border border-border/70 px-3">
            {chapters.map((chapter, index) => (
              <li key={chapter.order} className="border-b border-border/70 py-3 last:border-b-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm tabular-nums text-muted-foreground">
                    {String(chapter.order).padStart(2, "0")}
                  </span>
                  <span className="min-w-0 flex-1 text-sm font-medium text-foreground">{chapter.title}</span>
                  <ChapterStateBadge state={chapter.state} />
                  <ChapterPlanMenu
                    number={chapter.order}
                    title={chapter.title}
                    first={index === 0}
                    last={index === chapters.length - 1}
                    action={editor.action}
                  />
                </div>
                <ChapterMediaStatus media={chapter.media} />
                {chapter.scope && <p className="mt-0.5 text-sm text-muted-foreground">{chapter.scope}</p>}
                {chapter.prerequisites && !/^none$/i.test(chapter.prerequisites) && (
                  <p className="mt-0.5 text-xs text-muted-foreground">Prerequisites: {chapter.prerequisites}</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </section>

      {editor.overlays}
      <OtherNotes set={set} notes={course.data?.otherNotes ?? []} />

      {changing && (
        <PlanSetSheet
          set={set}
          title={summary?.title ?? set}
          initialGoal=""
          mode="change"
          onClose={() => setChanging(false)}
        />
      )}
      {planOpen && (
        <PlanSetSheet set={set} title={summary?.title ?? set} initialGoal="" onClose={() => setPlanOpen(false)} />
      )}
    </div>
  );
}
