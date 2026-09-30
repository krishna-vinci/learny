// `/s/:set` — the set's "Continue" page: the set's goal, ONE primary next step (from Today's
// do-next, see lib/continue-step.ts), a small row of secondary actions, the rest behind
// "More actions", and the notes list (docs/UX.md: one primary action per screen).
import type { JobView } from "@studium/shared";
import {
  ArrowRightIcon,
  BookOpenIcon,
  ChevronDownIcon,
  DownloadIcon,
  ListChecksIcon,
  MessageSquareIcon,
  NotebookTextIcon,
  PlusIcon,
  SparklesIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { Link, useParams } from "react-router-dom";
import { ApiError, api, bookUrl } from "@/api/client";
import { useBook, useJobs, useLibrary, useNoteFile, useNotes, useSets, useToday } from "@/api/queries";
import { openActivityPanel } from "@/components/Activity/activity-store";
import { openChatDock } from "@/components/ChatDock/openChatDock";
import { AddSourceSheet } from "@/components/Library/AddSourceSheet";
import { RowsSkeleton } from "@/components/ListSkeleton";
import { NewChapterSheet } from "@/components/NewChapterSheet";
import { NewNoteDialog } from "@/components/NewNoteDialog";
import { PlanSetSheet } from "@/components/PlanSetSheet";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { type ContinueStep, nextStep } from "@/lib/continue-step";
import { isActiveJob } from "@/lib/job-transitions";
import { cn } from "@/lib/utils";

function NoteRow({ set, path, title, order }: { set: string; path: string; title: string; order: number | null }) {
  return (
    <li>
      <Link
        to={`/s/${set}/n/${path.replace(/^notes\//, "")}`}
        className="flex min-h-11 items-center gap-2 border-b border-border/70 py-2.5 last:border-b-0 hover:bg-accent/40"
      >
        <ListChecksIcon className="size-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        {order != null && <span className="w-6 shrink-0 text-end text-sm text-muted-foreground">{order}</span>}
        <span className="min-w-0 flex-1 truncate text-foreground">{title}</span>
      </Link>
    </li>
  );
}

/** A3: a greyed drafting placeholder shown below the set's existing notes. */
function DraftingRow({ job }: { job: JobView }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => openActivityPanel(job.id)}
        aria-label={`Drafting ${job.title}: ${job.progress || "starting"}`}
        className="flex min-h-11 w-full items-center gap-2 border-b border-border/70 py-2.5 text-start last:border-b-0 hover:bg-accent/40"
      >
        <Spinner className="shrink-0 text-muted-foreground/70" aria-label="Drafting" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{job.title}</span>
        <span className="max-w-[10rem] shrink-0 truncate text-xs text-muted-foreground/80">
          {job.progress || "Drafting…"}
        </span>
      </button>
    </li>
  );
}

/** The PLAN.md "## Goal" section as one line; falls back to the text before the first heading. */
function goalText(body: string): string {
  const goal =
    /^##\s+Goal\s*\n([\s\S]*?)(?=^#{1,6}\s|(?![\s\S]))/m.exec(body)?.[1] ?? body.split(/^#{1,6}\s/m)[0] ?? "";
  return goal.replace(/\s+/g, " ").trim();
}

function formatBuilt(lastModified: string | null): string | null {
  if (!lastModified) return null;
  const date = new Date(lastModified);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

/** Build/rebuild the set's PDF book (`compile-book` job) and download the last build. */
function BookCard({ set, jobs }: { set: string; jobs: JobView[] }) {
  const { data: book, isLoading } = useBook(set);
  const [starting, setStarting] = useState(false);
  const bookJobs = jobs.filter((job) => job.kind === "compile-book" && job.set === set);
  const running = bookJobs.find(isActiveJob);
  // The newest job decides whether a failure is still the current story.
  const latest = bookJobs.at(0);
  const builtAt = book?.lastModified ? Date.parse(book.lastModified) : Number.NaN;
  const finishedAt = latest?.finishedAt ? Date.parse(latest.finishedAt) : Number.NaN;
  // A failure older than the current book is no longer the story (Last-Modified has 1 s resolution).
  const failed = latest?.status === "failed" && !(builtAt + 999 >= finishedAt) ? latest : undefined;
  const built = formatBuilt(book?.lastModified ?? null);

  async function build() {
    setStarting(true);
    try {
      await api.jobs.create({ kind: "compile-book", set });
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to start the book build.");
    } finally {
      setStarting(false);
    }
  }

  return (
    <section className="mt-6" aria-label="Book">
      <h2 className="text-sm font-semibold text-foreground">Book</h2>
      <Card size="sm" className="mt-2 flex-col gap-3 px-3 sm:flex-row sm:items-center">
        <BookOpenIcon className="hidden size-5 shrink-0 text-muted-foreground/70 sm:block" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-sm">
          {running ? (
            <p className="flex items-center gap-2 text-foreground">
              <Spinner className="shrink-0 text-muted-foreground" aria-label="Building" />
              <span className="min-w-0 truncate">{running.progress || "Building book…"}</span>
            </p>
          ) : isLoading ? (
            <Skeleton className="h-9 w-48" />
          ) : book ? (
            <>
              <p className="font-medium text-foreground">Your notes as a PDF book</p>
              {built && <p className="text-xs text-muted-foreground">Last built {built}</p>}
            </>
          ) : (
            <>
              <p className="font-medium text-foreground">Not built yet</p>
              <p className="text-xs text-muted-foreground">Compile this set's notes into a printable PDF.</p>
            </>
          )}
          {!running && failed && (
            <p className="mt-1 text-xs text-destructive">Last build failed: {failed.error ?? "unknown error"}</p>
          )}
        </div>
        <div className="flex gap-2">
          {book && !running && (
            <a
              href={bookUrl(set)}
              download
              className={cn(
                buttonVariants({ variant: "outline" }),
                "h-11 flex-1 items-center justify-center gap-1.5 sm:h-8 sm:flex-none",
              )}
            >
              <DownloadIcon className="size-4" aria-hidden="true" />
              Download
            </a>
          )}
          <Button
            className="h-11 flex-1 sm:h-8 sm:flex-none"
            disabled={!!running || starting}
            onClick={() => void build()}
          >
            {running || starting ? "Building…" : book ? "Rebuild" : "Build book (PDF)"}
          </Button>
        </div>
      </Card>
    </section>
  );
}

/** PLAN.md placeholders like "(not set yet)" are not a goal worth showing. */
function visibleText(text: string | null | undefined): string | null {
  const trimmed = text?.trim() ?? "";
  return trimmed === "" || /^\(.*\)$/.test(trimmed) ? null : trimmed;
}

/** The one primary action of the page: the next best step for this set. */
function ContinueCard({
  step,
  onNewChapter,
  onAddSource,
  onTutor,
}: {
  step: ContinueStep;
  onNewChapter: () => void;
  onAddSource: () => void;
  onTutor: () => void;
}) {
  const action =
    step.kind === "link" ? (
      <Link to={step.href} className={cn(buttonVariants(), "h-11 w-full justify-center sm:h-9 sm:w-auto")}>
        {step.cta}
        <ArrowRightIcon aria-hidden="true" />
      </Link>
    ) : (
      <Button
        className="h-11 w-full sm:h-9 sm:w-auto"
        onClick={step.kind === "new-chapter" ? onNewChapter : step.kind === "add-source" ? onAddSource : onTutor}
      >
        {step.cta}
        <ArrowRightIcon aria-hidden="true" />
      </Button>
    );
  return (
    <Card className="mt-5 gap-3 border-primary/40 bg-primary/5 px-4" aria-label="Next step">
      <div>
        <p className="text-2xs font-medium uppercase tracking-wide text-primary">Next step</p>
        <p className="mt-1 text-base font-semibold text-foreground">{step.title}</p>
        <p className="mt-0.5 text-sm text-muted-foreground">{step.detail}</p>
      </div>
      {action}
    </Card>
  );
}

export default function SetHomePage() {
  const params = useParams<{ set: string }>();
  const set = params.set as string;
  const { data: sets } = useSets();
  const { data: notes = [], isLoading: notesLoading } = useNotes(set);
  const { data: library = [] } = useLibrary();
  const { data: today } = useToday();
  const { data: jobs = [] } = useJobs(set);
  const { data: plan } = useNoteFile(set, "PLAN.md");

  const [newChapterOpen, setNewChapterOpen] = useState<{ title?: string } | null>(null);
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  const summary = sets?.find((s) => s.slug === set);
  const runningJobCount = jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const draftingJobs = jobs.filter((job) => job.kind === "draft-chapter" && job.set === set && isActiveJob(job));
  const linkedSources = library.filter((source) => source.sets.includes(set)).length;
  const step = nextStep({ set, doNext: today?.doNext ?? [], notesCount: notes.length, linkedSources });
  const goal = plan?.body ? visibleText(goalText(plan.body)) : null;
  const nextAction = visibleText(summary?.nextAction);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{summary?.title ?? set}</h1>
        {goal && <p className="mt-1 line-clamp-3 text-sm text-muted-foreground">{goal}</p>}
        {!goal && nextAction && <p className="mt-1 text-sm text-muted-foreground">{nextAction}</p>}
      </div>

      <ContinueCard
        step={step}
        onNewChapter={() => setNewChapterOpen({ title: step.kind === "new-chapter" ? step.chapterTitle : undefined })}
        onAddSource={() => setAddSourceOpen(true)}
        onTutor={() => openChatDock()}
      />
      {runningJobCount > 0 && (
        <p className="mt-2 text-sm text-muted-foreground">
          {runningJobCount} running in the background.{" "}
          <Link to="/jobs" className="text-primary underline underline-offset-2">
            See activity
          </Link>
        </p>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        {step.kind !== "add-source" && (
          <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={() => setAddSourceOpen(true)}>
            <PlusIcon aria-hidden="true" />
            Add source
          </Button>
        )}
        {step.kind !== "new-chapter" && (
          <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={() => setNewChapterOpen({})}>
            <NotebookTextIcon aria-hidden="true" />
            New chapter
          </Button>
        )}
        {step.kind !== "tutor" && (
          <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={() => openChatDock()}>
            <MessageSquareIcon aria-hidden="true" />
            Ask the tutor
          </Button>
        )}
        <Button
          variant="quiet"
          size="sm"
          className="h-11 md:h-8"
          aria-expanded={moreOpen}
          aria-controls="more-actions"
          onClick={() => setMoreOpen((open) => !open)}
        >
          More actions
          <ChevronDownIcon className={cn("transition-transform", moreOpen && "rotate-180")} aria-hidden="true" />
        </Button>
      </div>

      {moreOpen && (
        <div id="more-actions" className="mt-2 flex flex-col gap-2">
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={() => setNewNoteOpen(true)}>
              <ListChecksIcon aria-hidden="true" />
              Write a note
            </Button>
            <Button variant="outline" size="sm" className="h-11 md:h-8" onClick={() => setPlanOpen(true)}>
              <SparklesIcon aria-hidden="true" />
              Make a plan
            </Button>
          </div>
          <BookCard set={set} jobs={jobs} />
        </div>
      )}

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-foreground">Notes</h2>
        {notesLoading && <RowsSkeleton rows={3} className="mt-2" />}
        {!notesLoading && notes.length === 0 && draftingJobs.length === 0 && (
          <p className="mt-2 text-sm text-muted-foreground">Chapters you write or draft will be listed here.</p>
        )}
        {!notesLoading && (notes.length > 0 || draftingJobs.length > 0) && (
          <ul className="mt-2 rounded-md border border-border/70 px-3">
            {notes.map((note) => (
              <NoteRow key={note.path} set={set} path={note.path} title={note.title} order={note.order} />
            ))}
            {draftingJobs.map((job) => (
              <DraftingRow key={job.id} job={job} />
            ))}
          </ul>
        )}
      </section>

      {planOpen && (
        <PlanSetSheet
          set={set}
          title={summary?.title ?? set}
          initialGoal={plan?.body ? goalText(plan.body) : ""}
          onClose={() => setPlanOpen(false)}
        />
      )}
      {newChapterOpen && (
        <NewChapterSheet set={set} initialTitle={newChapterOpen.title} onClose={() => setNewChapterOpen(null)} />
      )}
      <NewNoteDialog set={set} open={newNoteOpen} onOpenChange={setNewNoteOpen} />
      <AddSourceSheet open={addSourceOpen} onOpenChange={setAddSourceOpen} defaultSet={set} />
    </div>
  );
}
