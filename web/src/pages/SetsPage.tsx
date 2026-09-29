// `/sets`: every study set as a card (title, next action, status), a prominent "New study
// set" button, and a check-marked link to the current one — see the sidebar's SetSwitcher,
// whose "All study sets" item and mobile trigger both land here.
import type { SetSummary } from "@studium/shared";
import { CheckIcon, LibraryBigIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useSets } from "@/api/queries";
import { NewSetDialog } from "@/components/NewSetDialog";
import { Button } from "@/components/ui/button";
import { useLastVisitedSet } from "./useLastVisitedSet";

const STATUS_LABEL: Record<SetSummary["status"], string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  done: "Done",
};

const STATUS_CLASSES: Record<SetSummary["status"], string> = {
  draft: "bg-muted text-muted-foreground",
  active: "bg-primary/15 text-primary",
  paused: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400",
  done: "bg-success/15 text-success",
};

function SetCard({ set, current }: { set: SetSummary; current: boolean }) {
  return (
    <li>
      <Link
        to={`/s/${set.slug}`}
        className="flex min-h-[76px] flex-col gap-1.5 rounded-lg border border-border/70 bg-background p-3.5 shadow-xs transition-colors hover:bg-accent/40"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="min-w-0 flex-1 truncate text-base font-medium text-foreground">{set.title}</p>
          <div className="flex shrink-0 items-center gap-1.5">
            <span className={`rounded-full px-2 py-0.5 text-2xs font-medium ${STATUS_CLASSES[set.status]}`}>
              {STATUS_LABEL[set.status]}
            </span>
            {current && <CheckIcon className="size-4 text-primary" aria-label="Current study set" />}
          </div>
        </div>
        <p className="line-clamp-2 text-sm text-muted-foreground">{set.nextAction ?? "No next action yet."}</p>
      </Link>
    </li>
  );
}

export default function SetsPage() {
  const { data: sets = [], isLoading } = useSets();
  const currentSet = useLastVisitedSet();
  const [newSetOpen, setNewSetOpen] = useState(false);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-semibold text-foreground">All study sets</h1>
        <Button className="h-10" onClick={() => setNewSetOpen(true)}>
          <PlusIcon /> New study set
        </Button>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

      {!isLoading && sets.length === 0 && (
        <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
          <LibraryBigIcon className="size-10 text-muted-foreground/60" />
          <p className="text-sm font-medium text-foreground">Create your first study set</p>
          <p className="max-w-xs text-sm text-muted-foreground">
            A study set holds the notes, sources, and cards for one thing you're learning.
          </p>
          <Button className="h-11" onClick={() => setNewSetOpen(true)}>
            <PlusIcon /> New study set
          </Button>
        </div>
      )}

      {sets.length > 0 && (
        <ul className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {sets.map((set) => (
            <SetCard key={set.slug} set={set} current={set.slug === currentSet} />
          ))}
        </ul>
      )}

      <NewSetDialog open={newSetOpen} onOpenChange={setNewSetOpen} />
    </div>
  );
}
