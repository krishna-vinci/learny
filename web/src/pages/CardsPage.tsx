// `/s/:set/cards` (M2 T6): one row per `<set>/cards/NN-slug.md`, chapter title from the
// note it was made from, status counts as chips, and a stale badge with a one-click
// re-check (a `make-cards` job with `count: 0` — Critic-only review; docs/plans/2026-09-29-
// m2-cards-and-review.md decision 6). Pattern follows InboxPage: list -> a review, here a
// separate route (`CardFilePage`) rather than local state, since card files are deep-linkable.
import type { CardFileView } from "@studium/shared";
import { AlertTriangleIcon, ChevronRightIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { useState } from "react";
import { toast } from "react-hot-toast";
import { useNavigate, useParams } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { useCardFiles, useNotes } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { type CARD_STATUS_ORDER, statusChips } from "./cards-utils";

const STATUS_CHIP_CLASSES: Record<(typeof CARD_STATUS_ORDER)[number], string> = {
  draft: "bg-muted text-muted-foreground",
  approved: "bg-success/15 text-success",
  rejected: "bg-destructive/15 text-destructive",
  exported: "bg-primary/15 text-primary",
};

/** `cards/03-svd.md` -> `03-svd.md` (the part of the path after the `cards/` prefix). */
function cardFileSlug(path: string): string {
  return path.replace(/^cards\//, "");
}

function CardFileRow({
  set,
  file,
  title,
  onOpen,
}: {
  set: string;
  file: CardFileView;
  title: string;
  onOpen: () => void;
}) {
  const [rechecking, setRechecking] = useState(false);

  async function recheck(event: MouseEvent) {
    event.stopPropagation();
    if (!file.note) return;
    setRechecking(true);
    try {
      await api.jobs.create({ kind: "make-cards", set, note: file.note, count: 0 });
      toast.success("Re-check started");
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to start the re-check.");
    } finally {
      setRechecking(false);
    }
  }

  return (
    <li>
      <button
        type="button"
        onClick={onOpen}
        className="flex min-h-11 w-full items-center gap-3 border-b border-border/70 py-3 text-start last:border-b-0 hover:bg-accent/40"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate font-medium text-foreground">{title}</span>
            {file.stale && (
              <span className="flex items-center gap-1 rounded-full bg-warning/15 px-2 py-0.5 text-2xs font-medium text-warning-foreground">
                <AlertTriangleIcon className="size-3" />
                stale — note changed
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {statusChips(file.counts).map((chip) => (
              <span
                key={chip.status}
                className={cn("rounded-full px-1.5 py-0.5 text-2xs font-medium", STATUS_CHIP_CLASSES[chip.status])}
              >
                {chip.count} {chip.status}
              </span>
            ))}
            {statusChips(file.counts).length === 0 && (
              <span className="text-2xs text-muted-foreground">No cards yet</span>
            )}
          </div>
        </div>
        {file.stale && (
          <Button variant="outline" size="sm" className="h-11 shrink-0 md:h-7" onClick={recheck} disabled={rechecking}>
            {rechecking ? "Starting…" : "Re-check"}
          </Button>
        )}
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

function CardsPage() {
  const params = useParams<{ set: string }>();
  const set = params.set as string;
  const navigate = useNavigate();
  const { data: files, isLoading, isError } = useCardFiles(set);
  const { data: notes = [] } = useNotes(set);

  const titleFor = (notePath: string | null): string => {
    if (!notePath) return "Unknown chapter";
    return notes.find((note) => note.path === notePath)?.title ?? notePath;
  };

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading cards…</div>;
  }
  if (isError || !files) {
    return <div className="p-6 text-sm text-destructive">Failed to load cards.</div>;
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6">
      <h1 className="text-lg font-semibold text-foreground">Cards</h1>

      {files.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          No card files yet. Open a note and use “Make cards” to draft some.
        </p>
      ) : (
        <ul className="mt-4 rounded-md border border-border/70 px-3">
          {files.map((file) => (
            <CardFileRow
              key={file.path}
              set={set}
              file={file}
              title={titleFor(file.note)}
              onOpen={() => navigate(`/s/${set}/cards/${cardFileSlug(file.path)}`)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

export default CardsPage;
