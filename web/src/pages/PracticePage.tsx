import { useRef } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { errorMessage, usePractice } from "@/api/practice";
import { useCurrentUser, useNotes, useSets } from "@/api/queries";
import { ErrorNotice, WeakTopics } from "@/components/Practice/common";
import { ProblemsTab } from "@/components/Practice/ProblemsTab";
import { QuizTab } from "@/components/Practice/QuizTab";
import { TeachBackTab } from "@/components/Practice/TeachBackTab";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const tabs = [
  { id: "quiz", label: "Quiz" },
  { id: "teachback", label: "Teach-back" },
  { id: "problems", label: "Problems" },
] as const;
export default function PracticePage() {
  const { set = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const topic = params.get("topic") ?? undefined;
  const tab = tabs.find((item) => item.id === params.get("tab"))?.id ?? "quiz";
  const { data: summary, isPending, error, refetch } = usePractice(set);
  const notes = useNotes(set);
  const { data: sets } = useSets();
  const { user } = useCurrentUser();
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  function select(key: string, value: string) {
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      return next;
    });
  }
  const weak =
    summary?.weakSpots
      .filter((spot) => spot.strength < 0.6 || spot.nextReview <= new Date().toISOString().slice(0, 10))
      .sort((a, b) => a.strength - b.strength)
      .slice(0, 3) ?? [];
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-6 pb-24 text-foreground sm:px-6">
      <header className="flex flex-col gap-4">
        <div>
          <Link
            to={`/s/${set}`}
            className="inline-flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground"
          >
            {sets?.find((item) => item.slug === set)?.title ?? set} /
          </Link>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h1 className="text-xl font-semibold">Practice</h1>
            {summary && (
              <span className="rounded-full bg-muted px-3 py-1.5 text-xs text-muted-foreground">
                {summary.dueCount} {summary.dueCount === 1 ? "topic" : "topics"} due
              </span>
            )}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">Recall, explain, and work it through.</p>
        </div>
        {weak.length > 0 && (
          <section aria-label="Weak topics">
            <p className="mb-2 text-xs font-medium text-muted-foreground">A little more practice</p>
            <WeakTopics spots={weak} set={set} selected={topic} />
          </section>
        )}
        {topic && (
          <div className="flex items-center gap-2 text-sm">
            <span>Focus: {topic}</span>
            <Button variant="quiet" className="min-h-11" onClick={() => select("topic", "")}>
              Clear focus
            </Button>
          </div>
        )}
      </header>
      <div role="tablist" aria-label="Practice modes" className="flex border-b border-border">
        {tabs.map((item, index) => (
          <button
            key={item.id}
            ref={(node) => {
              tabRefs.current[index] = node;
            }}
            type="button"
            id={`practice-tab-${item.id}`}
            role="tab"
            aria-selected={tab === item.id}
            aria-controls="practice-panel"
            tabIndex={tab === item.id ? 0 : -1}
            className={cn(
              "min-h-12 flex-1 border-b-2 px-3 py-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-ring",
              tab === item.id
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
            onClick={() => select("tab", item.id)}
            onKeyDown={(event) => {
              let next = index;
              if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
              else if (event.key === "ArrowLeft") next = (index + tabs.length - 1) % tabs.length;
              else if (event.key === "Home") next = 0;
              else if (event.key === "End") next = tabs.length - 1;
              else return;
              event.preventDefault();
              select("tab", tabs[next]?.id ?? "quiz");
              tabRefs.current[next]?.focus();
            }}
          >
            {item.label}
          </button>
        ))}
      </div>
      <div role="tabpanel" id="practice-panel" aria-labelledby={`practice-tab-${tab}`} className="min-w-0">
        {(isPending || notes.isPending) && (
          <p role="status" className="text-sm text-muted-foreground">
            Loading practice…
          </p>
        )}
        {(error || notes.error) && (
          <div className="flex flex-col gap-3">
            <ErrorNotice>{errorMessage(error ?? notes.error)}</ErrorNotice>
            <Button
              variant="outline"
              className="min-h-11 self-start"
              onClick={() => {
                void refetch();
                void notes.refetch();
              }}
            >
              Try again
            </Button>
          </div>
        )}
        {summary && notes.data && (
          <>
            {tab === "quiz" && (
              <QuizTab
                key={set}
                set={set}
                notes={notes.data}
                summary={summary}
                topic={topic}
                quizId={params.get("quiz") ?? ""}
                onSelect={(id) => select("quiz", id)}
                aiEnabled={user?.aiEnabled ?? false}
              />
            )}
            {tab === "teachback" && (
              <TeachBackTab
                key={`${set}-${topic ?? ""}`}
                set={set}
                notes={notes.data}
                summary={summary}
                topic={topic}
                aiEnabled={user?.aiEnabled ?? false}
              />
            )}
            {tab === "problems" && (
              <ProblemsTab
                key={`${set}-${topic ?? ""}`}
                set={set}
                notes={notes.data}
                summary={summary}
                topic={topic}
                file={params.get("file") ?? ""}
                onSelect={(file) => select("file", file)}
                aiEnabled={user?.aiEnabled ?? false}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
