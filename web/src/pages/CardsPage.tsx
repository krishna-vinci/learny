// `/s/:set/cards` (M2 T6): one row per `<set>/cards/NN-slug.md`, chapter title from the
// note it was made from, status counts as chips, and a stale badge with a one-click
// re-check (a `make-cards` job with `count: 0` — Critic-only review; docs/plans/2026-09-29-
// m2-cards-and-review.md decision 6). Pattern follows InboxPage: list -> a review, here a
// separate route (`CardFilePage`) rather than local state, since card files are deep-linkable.
import type { CardFileView } from "@studium/shared";
import { AlertTriangleIcon, ChevronRightIcon, LayersIcon } from "lucide-react";
import type { MouseEvent } from "react";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "@/api/client";
import { useCardFiles, useNotes } from "@/api/queries";
import { PageSkeleton } from "@/components/ListSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { friendlyMessage } from "@/lib/friendly-errors";
import { toast } from "@/lib/notify";
import { type CARD_STATUS_ORDER, statusChips } from "./cards-utils";

const STATUS_CHIP_VARIANTS: Record<(typeof CARD_STATUS_ORDER)[number], "muted" | "success" | "destructive" | "tint"> = {
  draft: "muted",
  approved: "success",
  rejected: "destructive",
  exported: "tint",
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
      toast.error(friendlyMessage(err, "Failed to start the re-check."));
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
              <Badge variant="warning">
                <AlertTriangleIcon />
                stale — note changed
              </Badge>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {statusChips(file.counts).map((chip) => (
              <Badge key={chip.status} variant={STATUS_CHIP_VARIANTS[chip.status]}>
                {chip.count} {chip.status}
              </Badge>
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
    return <PageSkeleton rows={3} />;
  }
  if (isError || !files) {
    return <div className="p-6 text-sm text-destructive">Failed to load cards.</div>;
  }

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 md:px-6">
      <h1 className="text-lg font-semibold text-foreground">Cards</h1>

      {files.length === 0 ? (
        <Empty className="mt-4">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <LayersIcon />
            </EmptyMedia>
            <EmptyTitle>No cards yet</EmptyTitle>
            <EmptyDescription>
              Flashcards help you remember what you read. Pick a chapter and the assistant drafts cards for you to
              review.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button className="h-11 md:h-9" onClick={() => navigate(`/s/${set}`)}>
              Choose a chapter
            </Button>
          </EmptyContent>
        </Empty>
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
