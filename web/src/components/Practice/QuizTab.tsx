import type { NoteSummary, PracticeSummary, QuestionType } from "@studium/shared";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "@/api/client";
import { errorMessage, practiceApi, practiceKey } from "@/api/practice";
import { openActivityPanel } from "@/components/Activity/activity-store";
import { showJobStartedToast } from "@/components/Activity/job-start-toast";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { ErrorNotice, fieldClass, quizScore } from "./common";
import { QuizRunner } from "./QuizRunner";

const questionTypes: { type: QuestionType; label: string }[] = [
  { type: "mcq", label: "Multiple choice" },
  { type: "multi", label: "Choose all" },
  { type: "short", label: "Short answer" },
  { type: "numeric", label: "Numeric" },
  { type: "cloze", label: "Fill in the blank" },
];
function NewQuizSheet({
  set,
  notes,
  summary,
  topic,
  onClose,
}: {
  set: string;
  notes: NoteSummary[];
  summary: PracticeSummary;
  topic?: string;
  onClose: () => void;
}) {
  const [selectedNotes, setNotes] = useState<string[]>([]);
  const [topics, setTopics] = useState<string[]>(
    topic
      ? [topic]
      : summary.weakSpots
          .filter((spot) => spot.strength < 0.6 || spot.nextReview <= new Date().toISOString().slice(0, 10))
          .map((spot) => spot.topic),
  );
  const [count, setCount] = useState(5);
  const [types, setTypes] = useState<QuestionType[]>(questionTypes.map((item) => item.type));
  const [difficulty, setDifficulty] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const availableTopics = [...new Set([...(topic ? [topic] : []), ...summary.weakSpots.map((spot) => spot.topic)])];
  function toggle<T>(items: T[], item: T) {
    return items.includes(item) ? items.filter((value) => value !== item) : [...items, item];
  }
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent showClose={false} className="sm:max-w-lg">
        <div className="flex items-center justify-between gap-2">
          <DialogTitle>New quiz</DialogTitle>
          <DialogClose className="min-h-11 px-3 text-sm" disabled={busy}>
            Close
          </DialogClose>
        </div>
        <DialogDescription>
          Grounded in your notes. Choose a focus, or leave notes unselected to use the whole set.
        </DialogDescription>
        <form
          className="flex min-h-0 flex-col gap-4 overflow-y-auto"
          onSubmit={async (event) => {
            event.preventDefault();
            setBusy(true);
            setError("");
            try {
              const reply = await api.jobs.create({
                kind: "make-quiz",
                set,
                count,
                types,
                ...(selectedNotes.length ? { notes: selectedNotes } : {}),
                ...(topics.length ? { topics: [...new Set(topics)] } : {}),
                ...(difficulty ? { difficulty: Number(difficulty) as 1 | 2 | 3 } : {}),
              });
              showJobStartedToast("Quiz", "Generating");
              openActivityPanel(reply.jobId);
              onClose();
            } catch (err) {
              setError(errorMessage(err));
              setBusy(false);
            }
          }}
        >
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">Notes</legend>
            {notes.map((note) => (
              <label key={note.path} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={selectedNotes.includes(note.path)}
                  onChange={() => setNotes(toggle(selectedNotes, note.path))}
                />
                {note.title}
              </label>
            ))}
          </fieldset>
          {availableTopics.length > 0 && (
            <fieldset className="flex flex-wrap gap-x-4">
              <legend className="text-sm font-medium">Topics</legend>
              {availableTopics.map((item) => (
                <label key={item} className="flex min-h-11 items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="size-4 accent-primary"
                    checked={topics.includes(item)}
                    onChange={() => setTopics(toggle(topics, item))}
                  />
                  {item}
                </label>
              ))}
            </fieldset>
          )}
          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1 text-sm font-medium">
              Questions
              <input
                className={fieldClass}
                type="number"
                min={5}
                max={20}
                required
                value={count}
                onChange={(event) => setCount(Number(event.target.value))}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm font-medium">
              Difficulty
              <select className={fieldClass} value={difficulty} onChange={(event) => setDifficulty(event.target.value)}>
                <option value="">Mixed</option>
                <option value="1">1 · Foundation</option>
                <option value="2">2 · Apply</option>
                <option value="3">3 · Challenge</option>
              </select>
            </label>
          </div>
          <fieldset className="flex flex-wrap gap-x-4">
            <legend className="text-sm font-medium">Question types</legend>
            {questionTypes.map((item) => (
              <label key={item.type} className="flex min-h-11 items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={types.includes(item.type)}
                  onChange={() => setTypes(toggle(types, item.type))}
                />
                {item.label}
              </label>
            ))}
          </fieldset>
          <ErrorNotice>{error}</ErrorNotice>
          <Button
            type="submit"
            className="min-h-11 shrink-0"
            disabled={busy || !types.length || !notes.length || count < 5 || count > 20}
          >
            {busy ? "Starting…" : "Generate quiz"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
export function QuizTab({
  set,
  notes,
  summary,
  topic,
  quizId,
  onSelect,
  aiEnabled,
}: {
  set: string;
  notes: NoteSummary[];
  summary: PracticeSummary;
  topic?: string;
  quizId: string;
  onSelect: (id: string) => void;
  aiEnabled: boolean;
}) {
  const [sheetOpen, setSheetOpen] = useState(false);
  const quiz = useQuery({
    queryKey: [...practiceKey(set), "quiz", quizId],
    queryFn: () => practiceApi.quiz(set, quizId),
    enabled: !!quizId,
  });
  if (quizId)
    return (
      <div className="flex flex-col gap-4">
        {quiz.isPending && <p role="status">Loading quiz…</p>}
        {quiz.isError && (
          <>
            <ErrorNotice>{errorMessage(quiz.error)}</ErrorNotice>
            <Button className="min-h-11" variant="outline" onClick={() => void quiz.refetch()}>
              Retry loading
            </Button>
            <Button variant="quiet" onClick={() => onSelect("")}>
              Back to quizzes
            </Button>
          </>
        )}
        {quiz.data && <QuizRunner key={quizId} set={set} quiz={quiz.data} onClose={() => onSelect("")} />}
      </div>
    );
  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-semibold">Your quizzes</h2>
          <p className="text-sm text-muted-foreground">A small check on what you've learned.</p>
        </div>
        <Button className="min-h-11 shrink-0" disabled={!aiEnabled || !notes.length} onClick={() => setSheetOpen(true)}>
          New quiz
        </Button>
      </div>
      {!aiEnabled && (
        <p className="text-sm text-muted-foreground">
          AI is disabled for this account. You can still take quizzes with automatically checked answers.
        </p>
      )}
      {!summary.quizzes.length && (
        <p className="rounded-lg border border-dashed border-border p-5 text-sm text-muted-foreground">
          No quizzes yet. Generate one from your notes to start practising.
        </p>
      )}
      <ul className="divide-y divide-border">
        {summary.quizzes.map((item) => (
          <li key={item.id}>
            <button
              type="button"
              className="flex min-h-20 w-full flex-wrap items-center justify-between gap-2 py-4 text-start hover:bg-accent/30 focus-visible:outline-2 focus-visible:outline-ring"
              onClick={() => onSelect(item.id)}
            >
              <span className="min-w-0">
                <span className="block font-medium">{item.title}</span>
                <span className="text-xs text-muted-foreground">
                  {item.questionCount} questions · {new Date(item.createdAt).toLocaleDateString()}
                </span>
              </span>
              <span className="text-sm text-muted-foreground">
                {quizScore(item.attempts, item.questionCount)} <span className="text-primary">Start →</span>
              </span>
            </button>
          </li>
        ))}
      </ul>
      {sheetOpen && (
        <NewQuizSheet set={set} notes={notes} summary={summary} topic={topic} onClose={() => setSheetOpen(false)} />
      )}
    </section>
  );
}
