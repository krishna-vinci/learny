import type { NoteSummary, PracticeAttemptResult, WeakSpot } from "@studium/shared";
import { useQuery } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { MarkdownView } from "@/components/Reader/MarkdownView";
import { chapterLabel } from "@/lib/chapter-label";
import { cn } from "@/lib/utils";

export const fieldClass =
  "min-h-11 w-full rounded-md border border-input bg-background px-3 py-2 text-base text-foreground focus-visible:outline-2 focus-visible:outline-ring";
export function Prose({ content }: { content: string }) {
  return (
    <MarkdownView
      content={content}
      className="[--reader-font-size:16px] [--reader-leading:1.6] [&>p:first-child]:mt-0 [&>p:last-child]:mb-0"
    />
  );
}
export function ErrorNotice({ children }: { children: ReactNode }) {
  return children ? (
    <p role="alert" className="text-sm text-destructive">
      {children}
    </p>
  ) : null;
}
export function noteUrl(set: string, note: string, anchor = "") {
  return `/s/${encodeURIComponent(set)}/n/${note.replace(/^notes\//, "")}${anchor ? `?q=${encodeURIComponent(anchor.replace(/^#/, ""))}` : ""}`;
}
export function citationUrl(set: string, note: string, citation: string) {
  const citedNote = /notes\/[a-z0-9._-]+\.md/.exec(citation)?.[0];
  const source = /(?:\[\^)?src:([^#\]\s]+)/.exec(citation)?.[1];
  if (source) return `/library/${encodeURIComponent(source)}`;
  const anchor = citation.includes("#")
    ? (citation.split("#").at(-1) ?? "").replaceAll("-", " ")
    : citedNote
      ? ""
      : citation;
  return noteUrl(set, citedNote ?? note, anchor);
}
export function NoteLink({
  set,
  note,
  anchor = "",
  label = "Read the note",
}: {
  set: string;
  note: string;
  anchor?: string;
  label?: string;
}) {
  return (
    <Link
      to={noteUrl(set, note, anchor)}
      className="inline-flex min-h-11 items-center text-sm text-primary underline underline-offset-4"
    >
      {label}
    </Link>
  );
}
export function Feedback({ set, result }: { set: string; result: PracticeAttemptResult }) {
  const answer =
    typeof result.answer === "object" && !Array.isArray(result.answer)
      ? result.answer.value
      : Array.isArray(result.answer)
        ? result.answer.join(", ")
        : result.answer;
  return (
    <section
      aria-label="Answer feedback"
      aria-live="polite"
      className="flex flex-col gap-3 rounded-lg border border-border bg-muted/40 p-4"
    >
      <p className={cn("font-semibold", result.verdict === "wrong" ? "text-destructive" : "text-foreground")}>
        {result.verdict === "right" ? "Correct" : result.verdict === "partial" ? "Partially correct" : "Not quite"}
        {result.revealed && " · Solution revealed"}
      </p>
      {result.feedback && <Prose content={result.feedback} />}
      <Prose content={`**Answer:** ${String(answer)}`} />
      {result.explanation && <Prose content={result.explanation} />}
      {result.solution && result.solution !== result.explanation && <Prose content={result.solution} />}
      <div className="flex flex-wrap gap-x-4">
        <NoteLink set={set} note={result.note} anchor={result.anchor} />
        {result.src && (
          <Link
            className="inline-flex min-h-11 items-center text-sm text-primary underline"
            to={`/library/${encodeURIComponent(result.src)}`}
          >
            Open source
          </Link>
        )}
      </div>
    </section>
  );
}
export function WeakTopics({
  spots,
  set,
  selected,
  onSelect,
}: {
  spots: WeakSpot[];
  set: string;
  selected?: string;
  onSelect?: (topic: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {spots.map((spot) => (
        <Link
          key={`${spot.note}-${spot.topic}`}
          to={`/s/${set}/practice?topic=${encodeURIComponent(spot.topic)}`}
          onClick={() => onSelect?.(spot.topic)}
          aria-label={`${spot.topic}, strength ${Math.round(spot.strength * 100)} percent`}
          className={cn(
            "flex min-h-11 min-w-28 flex-col justify-center gap-1 rounded-md border border-border px-3 py-2 text-sm hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring",
            selected === spot.topic && "border-primary bg-primary/5",
          )}
        >
          <span>
            {spot.topic} <span className="text-xs text-muted-foreground">{Math.round(spot.strength * 100)}%</span>
          </span>
          <span className="h-1 w-full overflow-hidden rounded-full bg-muted">
            <span className="block h-full bg-primary" style={{ width: `${spot.strength * 100}%` }} />
          </span>
        </Link>
      ))}
    </div>
  );
}
export function useSuggestedNote(set: string, notes: NoteSummary[], weakSpots: WeakSpot[], topic?: string) {
  const weakNote = weakSpots.find(
    (spot) =>
      (topic
        ? spot.topic === topic
        : spot.strength < 0.6 || spot.nextReview <= new Date().toISOString().slice(0, 10)) &&
      notes.some((note) => note.path === spot.note),
  )?.note;
  const recent = useQuery({
    queryKey: ["practice-note", set, ...notes.map((note) => note.path)],
    enabled: !weakNote && notes.length > 0,
    queryFn: async () => {
      const histories = await Promise.all(
        notes.map(async (note) => ({
          note: note.path,
          history: await api.sets.history(set, { path: note.path, limit: 1 }),
        })),
      );
      return (
        histories.sort((a, b) => (b.history[0]?.date ?? "").localeCompare(a.history[0]?.date ?? ""))[0]?.note ?? ""
      );
    },
  });
  return weakNote ?? recent.data ?? "";
}
export function NotePicker({
  notes,
  value,
  onChange,
  id,
}: {
  notes: NoteSummary[];
  value: string;
  onChange: (value: string) => void;
  id: string;
}) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium">
        Note
      </label>
      <select id={id} className={fieldClass} value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="" disabled>
          Choose a note
        </option>
        {notes.map((note) => (
          <option key={note.path} value={note.path}>
            {chapterLabel(note)}
          </option>
        ))}
      </select>
    </div>
  );
}
export function quizScore(attempts: PracticeAttemptResult[], questionCount: number) {
  const latest = new Map(attempts.map((attempt) => [attempt.questionId, attempt]));
  return latest.size
    ? `${Math.round(([...latest.values()].reduce((total, result) => total + result.score, 0) / questionCount) * 100)}% · ${latest.size}/${questionCount} answered`
    : "Not taken yet";
}
