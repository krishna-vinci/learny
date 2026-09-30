// `/sets`: every study set as a card (title, next action, status), a prominent "New study
// set" button, and a check-marked link to the current one — see the sidebar's SetSwitcher,
// whose "All study sets" item and mobile trigger both land here.
import type { SetSummary } from "@studium/shared";
import { CheckIcon, LibraryBigIcon, PlusIcon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useSets } from "@/api/queries";
import { RowsSkeleton } from "@/components/ListSkeleton";
import { NewSetDialog } from "@/components/NewSetDialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { useLastVisitedSet } from "./useLastVisitedSet";

const STATUS_LABEL: Record<SetSummary["status"], string> = {
  draft: "Draft",
  active: "Active",
  paused: "Paused",
  done: "Done",
};

const STATUS_VARIANTS: Record<SetSummary["status"], "muted" | "tint" | "warning" | "success"> = {
  draft: "muted",
  active: "tint",
  paused: "warning",
  done: "success",
};

function SetCard({ set, current }: { set: SetSummary; current: boolean }) {
  return (
    <li>
      <Link to={`/s/${set.slug}`} className="block rounded-lg focus-visible:outline-2 focus-visible:outline-ring">
        <Card size="sm" className="min-h-[76px] gap-1.5 shadow-xs transition-colors hover:bg-accent/40">
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <CardTitle className="min-w-0 flex-1 truncate">{set.title}</CardTitle>
              <div className="flex shrink-0 items-center gap-1.5">
                <Badge variant={STATUS_VARIANTS[set.status]}>{STATUS_LABEL[set.status]}</Badge>
                {current && <CheckIcon className="size-4 text-primary" aria-label="Current study set" />}
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <p className="line-clamp-2 text-sm text-muted-foreground">{set.nextAction ?? "No next action yet."}</p>
          </CardContent>
        </Card>
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
        <Button className="h-11 md:h-9" onClick={() => setNewSetOpen(true)}>
          <PlusIcon /> New study set
        </Button>
      </div>

      {isLoading && <RowsSkeleton rows={3} />}

      {!isLoading && sets.length === 0 && (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LibraryBigIcon />
            </EmptyMedia>
            <EmptyTitle>Create your first study set</EmptyTitle>
            <EmptyDescription>
              A study set holds the notes, sources, and cards for one thing you're learning.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button className="h-11" onClick={() => setNewSetOpen(true)}>
              <PlusIcon /> New study set
            </Button>
          </EmptyContent>
        </Empty>
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
