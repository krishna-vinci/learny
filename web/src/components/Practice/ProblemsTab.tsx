import type { NoteSummary, PracticeSummary, ProblemView } from "@studium/shared";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { api } from "@/api/client";
import { errorMessage, practiceApi, practiceKey, usePracticeAttempt } from "@/api/practice";
import { openActivityPanel } from "@/components/Activity/activity-store";
import { showJobStartedToast } from "@/components/Activity/job-start-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { chapterLabel } from "@/lib/chapter-label";
import { ErrorNotice, Feedback, fieldClass, NotePicker, Prose, useSuggestedNote } from "./common";

function ProblemCard({
  set,
  file,
  problem,
  index,
  aiEnabled,
}: {
  set: string;
  file: string;
  problem: ProblemView;
  index: number;
  aiEnabled: boolean;
}) {
  const [text, setText] = useState("");
  const [hints, setHints] = useState<{ index: number; text: string }[]>([]);
  const [remaining, setRemaining] = useState(problem.hintCount);
  const [hintBusy, setHintBusy] = useState(false);
  const [hintError, setHintError] = useState("");
  const [confirm, setConfirm] = useState(false);
  const grade = usePracticeAttempt(set);
  const feedback = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (grade.result) feedback.current?.focus();
  }, [grade.result]);
  const numeric = problem.answerType === "numeric";
  const valid = text.trim() && (!numeric || Number.isFinite(Number(text)));
  return (
    <article className="flex flex-col gap-4 rounded-lg border border-border bg-card p-4 sm:p-5">
      <h3 className="text-sm font-medium text-muted-foreground">
        Problem {index + 1} · {problem.topic} · Difficulty {problem.difficulty}
      </h3>
      <Prose content={problem.statement} />
      {hints.length > 0 && (
        <ol aria-label="Hints" className="flex flex-col gap-2">
          {hints.map((hint) => (
            <li key={hint.index} className="rounded-md bg-muted/50 p-3">
              <p className="mb-1 text-xs font-medium text-muted-foreground">Hint {hint.index + 1}</p>
              <Prose content={hint.text} />
            </li>
          ))}
        </ol>
      )}
      <div>
        <Button
          variant="outline"
          className="min-h-11"
          disabled={hintBusy || !remaining || grade.busy}
          onClick={async () => {
            setHintBusy(true);
            setHintError("");
            try {
              const reply = await practiceApi.hint(set, file, problem.id);
              if (reply.hint) setHints((previous) => [...previous, { index: reply.index, text: reply.hint as string }]);
              setRemaining(reply.remaining);
            } catch (err) {
              setHintError(errorMessage(err));
            } finally {
              setHintBusy(false);
            }
          }}
        >
          {hintBusy ? "Getting hint…" : remaining ? "Hint" : "No more hints"}
        </Button>
      </div>
      <ErrorNotice>{hintError}</ErrorNotice>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (valid && !grade.busy)
            void grade.submit(() => practiceApi.attempt(set, file, problem.id, numeric ? Number(text) : text));
        }}
      >
        <label htmlFor={`answer-${problem.id}`} className="text-sm font-medium">
          Your answer
        </label>
        <input
          id={`answer-${problem.id}`}
          className={fieldClass}
          inputMode={numeric ? "decimal" : "text"}
          value={text}
          disabled={grade.busy}
          onChange={(event) => setText(event.target.value)}
        />
        <div className="flex flex-wrap gap-2">
          <Button type="submit" className="min-h-11" disabled={!valid || grade.busy || (!numeric && !aiEnabled)}>
            {grade.busy ? "Grading…" : "Check"}
          </Button>
          <Button variant="outline" className="min-h-11" disabled={grade.busy} onClick={() => setConfirm(true)}>
            Reveal solution
          </Button>
          {grade.viewJob && (
            <Button variant="quiet" className="min-h-11" onClick={grade.viewJob}>
              View progress
            </Button>
          )}
        </div>
        {!numeric && !aiEnabled && (
          <p className="text-sm text-muted-foreground">AI grading is disabled. Hints and the solution are available.</p>
        )}
      </form>
      <ErrorNotice>{grade.error}</ErrorNotice>
      {grade.result && (
        <div ref={feedback} tabIndex={-1} className="outline-none">
          <Feedback set={set} result={grade.result} />
        </div>
      )}
      <Dialog open={confirm} onOpenChange={setConfirm}>
        <DialogContent showClose={false}>
          <DialogTitle>Reveal the worked solution?</DialogTitle>
          <DialogDescription>
            This records a revealed attempt. Your score for this problem will be capped at partial, even if you answer
            correctly later.
          </DialogDescription>
          <div className="flex flex-wrap gap-2">
            <DialogClose className="min-h-11 rounded-md border border-border px-4 text-sm">Keep trying</DialogClose>
            <Button
              className="min-h-11"
              onClick={() => {
                setConfirm(false);
                void grade
                  .submit(() => practiceApi.reveal(set, file, problem.id))
                  .then(() => feedback.current?.focus());
              }}
            >
              Reveal solution
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </article>
  );
}
export function ProblemsTab({
  set,
  notes,
  summary,
  topic,
  file,
  onSelect,
  aiEnabled,
}: {
  set: string;
  notes: NoteSummary[];
  summary: PracticeSummary;
  topic?: string;
  file: string;
  onSelect: (file: string) => void;
  aiEnabled: boolean;
}) {
  const [chosenNote, setNote] = useState("");
  const suggestedNote = useSuggestedNote(set, notes, summary.weakSpots, topic);
  const note = chosenNote || suggestedNote;
  const [count, setCount] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const problems = useQuery({
    queryKey: [...practiceKey(set), "problems", file],
    queryFn: () => practiceApi.problems(set, file),
    enabled: !!file,
  });
  return (
    <section className="flex flex-col gap-5">
      <div>
        <h2 className="font-semibold">Work through a problem</h2>
        <p className="text-sm text-muted-foreground">
          Try it first. Hints and worked solutions are here when you need them.
        </p>
      </div>
      <form
        className="flex flex-col gap-3 rounded-lg border border-border p-4"
        onSubmit={async (event) => {
          event.preventDefault();
          setBusy(true);
          setError("");
          try {
            const reply = await api.jobs.create({ kind: "make-problems", set, note, count });
            showJobStartedToast("Problems", "Generating");
            openActivityPanel(reply.jobId);
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div className="grid gap-3 sm:grid-cols-[1fr_8rem]">
          <NotePicker id="problems-note" notes={notes} value={note} onChange={setNote} />
          <label className="flex flex-col gap-1 text-sm font-medium">
            Problems
            <input
              className={fieldClass}
              type="number"
              min={3}
              max={8}
              required
              value={count}
              onChange={(event) => setCount(Number(event.target.value))}
            />
          </label>
        </div>
        <Button
          type="submit"
          className="min-h-11 self-start"
          disabled={busy || !note || !aiEnabled || count < 3 || count > 8}
        >
          {busy ? "Starting…" : "Generate problems"}
        </Button>
        <ErrorNotice>{error}</ErrorNotice>
      </form>
      <label className="flex flex-col gap-1 text-sm font-medium">
        Saved problem sets
        <select className={fieldClass} value={file} onChange={(event) => onSelect(event.target.value)}>
          <option value="">Choose a problem set</option>
          {summary.problemSets.map((item) => {
            const note = notes.find((candidate) => candidate.path === item.note);
            return (
              <option key={item.file} value={item.file}>
                {note ? chapterLabel(note) : item.note} · {item.problemCount} problems
              </option>
            );
          })}
        </select>
      </label>
      {!summary.problemSets.length && (
        <p className="text-sm text-muted-foreground">No problem sets yet. Generate one from a note.</p>
      )}
      {file && problems.isPending && <p role="status">Loading problems…</p>}
      {problems.isError && (
        <>
          <ErrorNotice>{errorMessage(problems.error)}</ErrorNotice>
          <Button variant="outline" className="min-h-11 self-start" onClick={() => void problems.refetch()}>
            Retry loading
          </Button>
        </>
      )}
      {problems.data?.problems.map((problem, index) => (
        <ProblemCard
          key={`${file}-${problem.id}`}
          set={set}
          file={file}
          problem={problem}
          index={index}
          aiEnabled={aiEnabled}
        />
      ))}
    </section>
  );
}
