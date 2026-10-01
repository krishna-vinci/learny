import type { NoteSummary, PracticeSummary, TeachBackResult } from "@studium/shared";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { errorMessage, practiceApi, useRefreshPractice } from "@/api/practice";
import { Button } from "@/components/ui/button";
import { citationUrl, ErrorNotice, fieldClass, NoteLink, NotePicker, Prose, useSuggestedNote } from "./common";

function Rubric({ result, set }: { result: TeachBackResult; set: string }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (result.id) heading.current?.focus();
  }, [result.id]);
  return (
    <section
      className="flex flex-col gap-5 rounded-lg border border-border bg-card p-4 sm:p-5"
      aria-label="Teach-back feedback"
      aria-live="polite"
    >
      <div>
        <h3 ref={heading} tabIndex={-1} className="font-semibold outline-none">
          Your teach-back · {Math.round(result.score * 100)}%
        </h3>
        <p className="text-sm text-muted-foreground">{result.topic}</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {(["accuracy", "completeness", "clarity"] as const).map((key) => (
          <div key={key}>
            <div id={`rubric-${key}`} className="mb-1 flex justify-between gap-2 text-sm capitalize">
              {key}
              <span>{result[key]}/4</span>
            </div>
            <div
              role="progressbar"
              aria-labelledby={`rubric-${key}`}
              aria-valuemin={0}
              aria-valuemax={4}
              aria-valuenow={result[key]}
              className="h-2 overflow-hidden rounded-full bg-muted"
            >
              <span className="block h-full bg-primary" style={{ width: `${(result[key] / 4) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
      {result.misconceptions.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Misconceptions to revisit</h4>
          <ul className="flex flex-col gap-3">
            {result.misconceptions.map((item) => (
              <li key={`${item.claim}-${item.correction}`} className="border-s-2 border-primary ps-3">
                <p className="text-sm text-muted-foreground">You said: {item.claim}</p>
                <Prose content={item.correction} />
                <Link
                  to={citationUrl(set, result.note, item.citation)}
                  className="inline-flex min-h-11 items-center break-all text-sm text-primary underline"
                >
                  {item.citation || "Read the note"}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result.missing.length > 0 && (
        <div>
          <h4 className="mb-2 text-sm font-semibold">Missing ideas</h4>
          <ul className="list-disc space-y-1 ps-5 text-sm">
            {[...new Set(result.missing)].map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}
      <Prose content={result.feedback} />
      <NoteLink set={set} note={result.note} />
    </section>
  );
}
export function TeachBackTab({
  set,
  notes,
  summary,
  topic,
  aiEnabled,
}: {
  set: string;
  notes: NoteSummary[];
  summary: PracticeSummary;
  topic?: string;
  aiEnabled: boolean;
}) {
  const [chosenNote, setNote] = useState("");
  const suggestedNote = useSuggestedNote(set, notes, summary.weakSpots, topic);
  const note = chosenNote || suggestedNote;
  const [focusTopic, setTopic] = useState(topic ?? "");
  const [text, setText] = useState("");
  const [result, setResult] = useState<TeachBackResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const refresh = useRefreshPractice(set);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  return (
    <div className="flex flex-col gap-6">
      <form
        className="flex flex-col gap-4"
        onSubmit={async (event) => {
          event.preventDefault();
          if (busy || !text.trim() || !note) return;
          setBusy(true);
          setError("");
          try {
            const reply = await practiceApi.teachback(set, {
              note,
              text,
              ...(focusTopic.trim() ? { topic: focusTopic.trim() } : {}),
            });
            setResult(reply);
            refresh();
          } catch (err) {
            setError(errorMessage(err));
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <h2 ref={heading} tabIndex={-1} className="font-semibold outline-none">
            Explain it as if to a friend
          </h2>
          <p className="text-sm text-muted-foreground">
            Use your own words. The feedback will point you back to your notes.
          </p>
        </div>
        <fieldset className="grid gap-3 sm:grid-cols-2" disabled={busy}>
          <NotePicker id="teachback-note" notes={notes} value={note} onChange={setNote} />
          <label className="flex flex-col gap-1 text-sm font-medium">
            Topic (optional)
            <input className={fieldClass} value={focusTopic} onChange={(event) => setTopic(event.target.value)} />
          </label>
        </fieldset>
        <label htmlFor="teachback-text" className="text-sm font-medium">
          Your explanation
        </label>
        <textarea
          ref={textarea}
          id="teachback-text"
          className={`${fieldClass} min-h-56 resize-y`}
          rows={9}
          maxLength={8000}
          value={text}
          disabled={busy}
          onChange={(event) => {
            setText(event.target.value);
            setResult(null);
          }}
          placeholder="Explain the idea, how it works, and why it matters…"
          aria-describedby="teachback-limit"
        />
        <p id="teachback-limit" className="text-xs text-muted-foreground">
          {text.length}/8000 characters
        </p>
        <ErrorNotice>{error}</ErrorNotice>
        {!aiEnabled && (
          <p className="text-sm text-muted-foreground">
            AI grading is disabled for this account. Previous feedback is still available below.
          </p>
        )}
        <div className="sticky bottom-0 z-10 -mx-4 flex min-h-20 items-center border-t border-border bg-background px-4 py-3 pe-24 sm:mx-0 sm:pe-4">
          <Button type="submit" className="min-h-11" disabled={busy || !text.trim() || !note || !aiEnabled}>
            {busy ? "Grading your explanation…" : "Grade teach-back"}
          </Button>
        </div>
        {busy && (
          <p role="status" className="text-sm text-muted-foreground">
            Reading your explanation against the note…
          </p>
        )}
      </form>
      {result && (
        <>
          <Rubric set={set} result={result} />
          <Button
            variant="outline"
            className="min-h-11 self-start"
            onClick={() => {
              setResult(null);
              requestAnimationFrame(() => textarea.current?.focus());
            }}
          >
            Try again
          </Button>
        </>
      )}
      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">Earlier teach-backs</h2>
        {!summary.teachbacks.length && (
          <p className="text-sm text-muted-foreground">Your feedback history will appear here.</p>
        )}
        <ul className="divide-y divide-border">
          {summary.teachbacks.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className="flex min-h-14 w-full items-center justify-between gap-3 py-3 text-start text-sm hover:bg-accent/30 focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => {
                  setResult(item);
                  heading.current?.focus();
                }}
              >
                <span>
                  {item.topic} · {new Date(item.createdAt).toLocaleDateString()}
                </span>
                <span className="shrink-0 text-primary">{Math.round(item.score * 100)}% · View</span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
