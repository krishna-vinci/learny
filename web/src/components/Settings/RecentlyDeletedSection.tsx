import { useQuery } from "@tanstack/react-query";
import { RotateCcwIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "@/api/client";
import { queryKeys } from "@/api/queries";
import { deletionError, useRestoreDeleted } from "@/components/Deletion";
import { RowsSkeleton } from "@/components/ListSkeleton";
import { Button } from "@/components/ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

export default function RecentlyDeletedSection() {
  const {
    data: items = [],
    isPending,
    error,
    refetch,
  } = useQuery({ queryKey: queryKeys.recentlyDeleted, queryFn: () => api.sets.recentlyDeleted() });
  const { restore } = useRestoreDeleted();
  const [pending, setPending] = useState<string | null>(null);
  const [restored, setRestored] = useState<{ set: string; path?: string; title: string } | null>(null);
  return (
    <section>
      <h1 className="text-lg font-semibold text-foreground">Recently deleted</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        Restore deleted notes and study sets with their linked files. New work is kept if a restore conflicts.
      </p>
      {isPending ? (
        <RowsSkeleton rows={3} className="mt-4" />
      ) : error ? (
        <div className="mt-4">
          <p role="alert" className="text-sm text-destructive">
            {deletionError(error)}
          </p>
          <Button variant="outline" className="mt-2 h-11" onClick={() => void refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          {restored && (
            <p role="status" className="mt-4 text-sm text-foreground">
              {restored.title} restored.{" "}
              <Link
                className="text-primary underline"
                to={
                  restored.path ? `/s/${restored.set}/n/${restored.path.replace(/^notes\//, "")}` : `/s/${restored.set}`
                }
              >
                Open
              </Link>
            </p>
          )}
          {items.length === 0 ? (
            <Empty className="mt-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <Trash2Icon />
                </EmptyMedia>
                <EmptyTitle>Nothing deleted</EmptyTitle>
                <EmptyDescription>Notes and sets you delete will appear here, ready to restore.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className="mt-4 divide-y divide-border/70 rounded-lg border border-border/70 px-3">
              {items.map((item) => (
                <li key={item.sha} className="flex items-start gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="break-words text-sm font-medium text-foreground">{item.title}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {item.kind === "set" ? "Study set" : `Note in ${item.set}`} ·{" "}
                      {new Date(item.date).toLocaleDateString()}
                    </p>
                    {item.exportedCards > 0 && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.exportedCards} exported cards remain in Anki.
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline"
                    className="h-11 shrink-0"
                    disabled={pending !== null}
                    aria-label={`Restore ${item.title}`}
                    onClick={async () => {
                      setPending(item.sha);
                      await restore(item.set, item.sha, () => setRestored(item));
                      setPending(null);
                    }}
                  >
                    <RotateCcwIcon />
                    {pending === item.sha ? "Restoring…" : "Restore"}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  );
}
