// `/s/:set` — the set's home page (replaces the old `SetOverviewPlaceholder`, which left
// phones on a blank screen since the note list lives behind the ☰ drawer there). Shows
// the set's goal/next action, the primary authoring actions, the notes list, a "waiting
// on you" summary, and — for a set with no notes yet — a "how it works" empty state.
import type { JobView } from "@studium/shared";
import {
  ArchiveIcon,
  BookOpenIcon,
  DownloadIcon,
  ListChecksIcon,
  Loader2Icon,
  MessageSquareIcon,
  NotebookTextIcon,
  PlusIcon,
  SparklesIcon,
  WrenchIcon,
} from "lucide-react";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { Link, useParams } from "react-router-dom";
import { ApiError, api, bookUrl } from "@/api/client";
import { useBook, useCardFiles, useInbox, useJobs, useNoteFile, useNotes, useSets } from "@/api/queries";
import { openActivityPanel } from "@/components/Activity/activity-store";
import { openChatDock } from "@/components/ChatDock/openChatDock";
import { AddSourceSheet } from "@/components/Library/AddSourceSheet";
import { NewChapterSheet } from "@/components/NewChapterSheet";
import { NewNoteDialog } from "@/components/NewNoteDialog";
import { PlanSetSheet } from "@/components/PlanSetSheet";
import { Button, buttonVariants } from "@/components/ui/button";
import { isActiveJob } from "@/lib/job-transitions";
import { cn } from "@/lib/utils";

function ActionButton({
  icon: Icon,
  label,
  description,
  onClick,
}: {
  icon: typeof PlusIcon;
  label: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-[72px] flex-col items-start gap-1 rounded-lg border border-border/70 bg-background p-3 text-start shadow-xs transition-colors hover:bg-accent/40"
    >
      <span className="flex items-center gap-2 font-medium text-foreground">
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        {label}
      </span>
      <span className="text-sm text-muted-foreground">{description}</span>
    </button>
  );
}

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
        <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground/70" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{job.title}</span>
        <span className="max-w-[10rem] shrink-0 truncate text-xs text-muted-foreground/80">
          {job.progress || "Drafting…"}
        </span>
      </button>
    </li>
  );
}

function WaitingRow({
  icon: Icon,
  label,
  count,
  to,
}: {
  icon: typeof ArchiveIcon;
  label: string;
  count: number;
  to: string;
}) {
  if (count === 0) return null;
  return (
    <li>
      <Link
        to={to}
        className="flex min-h-11 items-center gap-2 border-b border-border/70 py-2 last:border-b-0 hover:bg-accent/40"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground/70" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-foreground">{label}</span>
        <span className="shrink-0 rounded-full bg-primary/15 px-2 py-0.5 text-xs font-medium text-primary">
          {count}
        </span>
      </Link>
    </li>
  );
}

function HowItWorks({
  onNewChapter,
  onWriteNote,
  onAddSource,
}: {
  onNewChapter: () => void;
  onWriteNote: () => void;
  onAddSource: () => void;
}) {
  const steps = [
    { n: 1, title: "Add a source", body: "Bring in a web page, PDF, or paper to learn from." },
    { n: 2, title: "New chapter", body: "The agent drafts a note from your sources, and a checker verifies it." },
    { n: 3, title: "Make cards", body: "Turn a note into flashcards, review them, then send to Anki." },
  ];
  return (
    <div className="mt-6 rounded-lg border border-dashed border-border/70 p-4">
      <p className="text-sm font-medium text-foreground">How it works</p>
      <ol className="mt-3 flex flex-col gap-3">
        {steps.map((step) => (
          <li key={step.n} className="flex items-start gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground">
              {step.n}
            </span>
            <div className="min-w-0">
              <p className="font-medium text-foreground">{step.title}</p>
              <p className="text-sm text-muted-foreground">{step.body}</p>
            </div>
          </li>
        ))}
      </ol>
      <div className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <ActionButton icon={PlusIcon} label="Add source" description="Web page, PDF, paper…" onClick={onAddSource} />
        <ActionButton
          icon={NotebookTextIcon}
          label="New chapter"
          description="Draft from sources"
          onClick={onNewChapter}
        />
        <ActionButton icon={ListChecksIcon} label="Write a note" description="Start from blank" onClick={onWriteNote} />
      </div>
    </div>
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
      <div className="mt-2 flex flex-col gap-3 rounded-md border border-border/70 p-3 sm:flex-row sm:items-center">
        <BookOpenIcon className="hidden size-5 shrink-0 text-muted-foreground/70 sm:block" aria-hidden="true" />
        <div className="min-w-0 flex-1 text-sm">
          {running ? (
            <p className="flex items-center gap-2 text-foreground">
              <Loader2Icon className="size-4 shrink-0 animate-spin text-muted-foreground" aria-hidden="true" />
              <span className="min-w-0 truncate">{running.progress || "Building book…"}</span>
            </p>
          ) : isLoading ? (
            <p className="text-muted-foreground">Checking…</p>
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
      </div>
    </section>
  );
}

export default function SetHomePage() {
  const params = useParams<{ set: string }>();
  const set = params.set as string;
  const { data: sets } = useSets();
  const { data: notes = [], isLoading: notesLoading } = useNotes(set);
  const { data: inboxItems = [] } = useInbox(set);
  const { data: cardFiles = [] } = useCardFiles(set);
  const { data: jobs = [] } = useJobs(set);
  const { data: plan } = useNoteFile(set, "PLAN.md");

  const [newChapterOpen, setNewChapterOpen] = useState(false);
  const [newNoteOpen, setNewNoteOpen] = useState(false);
  const [addSourceOpen, setAddSourceOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

  const summary = sets?.find((s) => s.slug === set);
  const planCount = inboxItems.filter((item) => item.kind === "plan").length;
  const chapterCount = inboxItems.length - planCount;
  const draftCardCount = cardFiles.reduce((total, file) => total + (file.counts.draft ?? 0), 0);
  const runningJobCount = jobs.filter((job) => job.status === "queued" || job.status === "running").length;
  const draftingJobs = jobs.filter((job) => job.kind === "draft-chapter" && job.set === set && isActiveJob(job));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:px-6">
      <div>
        <h1 className="text-xl font-semibold text-foreground">{summary?.title ?? set}</h1>
        {summary?.nextAction && <p className="mt-1 text-sm text-muted-foreground">{summary.nextAction}</p>}
        {plan?.body && <p className="mt-2 line-clamp-3 text-sm text-muted-foreground">{goalText(plan.body)}</p>}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <ActionButton
          icon={NotebookTextIcon}
          label="New chapter"
          description="Draft from sources"
          onClick={() => setNewChapterOpen(true)}
        />
        <ActionButton
          icon={ListChecksIcon}
          label="Write a note"
          description="Start from blank"
          onClick={() => setNewNoteOpen(true)}
        />
        <ActionButton
          icon={PlusIcon}
          label="Add source"
          description="Web page, PDF, paper…"
          onClick={() => setAddSourceOpen(true)}
        />
        <ActionButton
          icon={SparklesIcon}
          label="Plan with agent"
          description="Propose a plan and outline"
          onClick={() => setPlanOpen(true)}
        />
        <ActionButton
          icon={MessageSquareIcon}
          label="Ask tutor"
          description="Chat about this set"
          onClick={() => openChatDock()}
        />
      </div>

      {(inboxItems.length > 0 || draftCardCount > 0 || runningJobCount > 0) && (
        <section className="mt-6">
          <h2 className="text-sm font-semibold text-foreground">Waiting on you</h2>
          <ul className={cn("mt-2 rounded-md border border-border/70 px-3")}>
            <WaitingRow icon={ArchiveIcon} label="Chapters to review" count={chapterCount} to={`/s/${set}/inbox`} />
            <WaitingRow icon={ListChecksIcon} label="Plans to review" count={planCount} to={`/s/${set}/inbox`} />
            <WaitingRow
              icon={NotebookTextIcon}
              label="Draft cards to review"
              count={draftCardCount}
              to={`/s/${set}/cards`}
            />
            <WaitingRow icon={WrenchIcon} label="Jobs running" count={runningJobCount} to="/jobs" />
          </ul>
        </section>
      )}

      <BookCard set={set} jobs={jobs} />

      <section className="mt-6">
        <h2 className="text-sm font-semibold text-foreground">Notes</h2>
        {notesLoading && <p className="mt-2 text-sm text-muted-foreground">Loading…</p>}
        {!notesLoading && notes.length === 0 && draftingJobs.length === 0 && (
          <HowItWorks
            onNewChapter={() => setNewChapterOpen(true)}
            onWriteNote={() => setNewNoteOpen(true)}
            onAddSource={() => setAddSourceOpen(true)}
          />
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
      {newChapterOpen && <NewChapterSheet set={set} onClose={() => setNewChapterOpen(false)} />}
      <NewNoteDialog set={set} open={newNoteOpen} onOpenChange={setNewNoteOpen} />
      <AddSourceSheet open={addSourceOpen} onOpenChange={setAddSourceOpen} defaultSet={set} />
    </div>
  );
}
