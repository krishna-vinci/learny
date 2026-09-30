import type { CommitInfo } from "@studium/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeftIcon, RotateCcwIcon, XIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { api, outsidePaths } from "@/api/client";
import { queryKeys } from "@/api/queries";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { toast } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { DiffView } from "./DiffView";

export interface NoteHistoryProps {
  set: string;
  path: string;
  className?: string;
  onClose?: () => void;
  /** Commit to preselect, e.g. from a chat "view diff" link's `?commit=` query param. */
  initialSha?: string;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** History panel: commit list (`GET /history`), diff for the selected commit (`GET /diff`),
 * and a revert action (`POST /revert`) that refetches the note, its notes list, and its history.
 *
 * Below `lg` this renders as a full-screen sheet (list and diff are separate screens, with a
 * back button between them) instead of the desktop side panel, so the note reader never gets
 * crushed into a sliver next to it on phones. */
export function NoteHistory({ set, path, className, onClose, initialSha }: NoteHistoryProps) {
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const queryClient = useQueryClient();
  const [selectedSha, setSelectedSha] = useState<string | undefined>(initialSha);
  const [reverting, setReverting] = useState(false);
  // Paths outside this set that the selected commit also touched; non-null opens the set-only confirm.
  const [outside, setOutside] = useState<string[] | null>(null);

  // A commit link (chat "view diff", or re-navigating to the same route with a new `?commit=`)
  // can arrive while this panel is already mounted; sync the selection when it changes.
  useEffect(() => {
    if (initialSha) setSelectedSha(initialSha);
  }, [initialSha]);

  const historyQuery = useQuery<CommitInfo[]>({
    queryKey: queryKeys.history(set, path),
    queryFn: () => api.sets.history(set, { path }),
  });

  const diffQuery = useQuery<{ diff: string }>({
    queryKey: ["sets", set, "diff", path, selectedSha ?? null],
    queryFn: () => api.sets.diff(set, selectedSha as string, path),
    enabled: !!selectedSha,
  });

  const finishRevert = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: queryKeys.file(set, path) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.history(set, path) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.notes(set) }),
    ]);
    toast.success("Reverted");
    setSelectedSha(undefined);
  };

  const handleRevert = async () => {
    if (!selectedSha) return;
    if (!window.confirm("Revert this note to this version? This cannot be undone.")) return;
    setReverting(true);
    try {
      await api.sets.revert(set, selectedSha);
      await finishRevert();
    } catch (err) {
      const paths = outsidePaths(err);
      if (paths) setOutside(paths);
      else toast.error(err instanceof Error ? err.message : "Revert failed");
    } finally {
      setReverting(false);
    }
  };

  const handleRevertSetOnly = async () => {
    if (!selectedSha) return;
    try {
      await api.sets.revert(set, selectedSha, "set");
      await finishRevert();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revert failed");
    }
  };

  const setOnlyDialog = (
    <ConfirmDialog
      open={outside !== null}
      onOpenChange={(open) => {
        if (!open) setOutside(null);
      }}
      title="Revert only this set?"
      description="This commit also changed files outside this set. Reverting it here would restore only this set's files to their previous version. Any later edits to those files are overwritten."
      confirmLabel="Revert this set only"
      confirmVariant="destructive"
      onConfirm={handleRevertSetOnly}
    >
      <div className="min-w-0">
        <p className="text-xs font-medium text-foreground">Left unchanged ({outside?.length ?? 0}):</p>
        <ul className="mt-1 max-h-32 overflow-y-auto rounded-md border border-border/70 p-2 font-mono text-xs text-muted-foreground">
          {outside?.map((outsidePath) => (
            <li key={outsidePath} className="break-all">
              {outsidePath}
            </li>
          ))}
        </ul>
      </div>
    </ConfirmDialog>
  );

  const commitList = (
    <ul>
      {historyQuery.data?.map((commit) => (
        <li key={commit.sha}>
          <button
            type="button"
            onClick={() => setSelectedSha(commit.sha)}
            aria-pressed={commit.sha === selectedSha}
            className={cn(
              "w-full px-3 py-2 text-left text-xs hover:bg-accent/50",
              commit.sha === selectedSha && "bg-accent text-accent-foreground",
            )}
          >
            <div className="truncate font-medium">{commit.subject}</div>
            <div className="text-muted-foreground">
              {commit.author} · {formatDate(commit.date)} · {commit.sha.slice(0, 7)}
            </div>
          </button>
        </li>
      ))}
    </ul>
  );

  const commitListPanel = (
    <ScrollArea className={isDesktop ? "max-h-48 shrink-0 border-b border-border/70" : "min-h-0 flex-1"}>
      {historyQuery.isLoading && <div className="p-3 text-sm text-muted-foreground">Loading…</div>}
      {historyQuery.isError && <div className="p-3 text-sm text-destructive">Failed to load history.</div>}
      {historyQuery.data?.length === 0 && <div className="p-3 text-sm text-muted-foreground">No commits yet.</div>}
      {commitList}
    </ScrollArea>
  );

  const diffPanel = (
    <>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs text-muted-foreground">{selectedSha?.slice(0, 7)}</span>
      </div>
      <ScrollArea className="min-h-0 flex-1 px-3 pb-3">
        {diffQuery.isLoading && <div className="text-sm text-muted-foreground">Loading diff…</div>}
        {diffQuery.isError && <div className="text-sm text-destructive">Failed to load diff.</div>}
        {diffQuery.data && <DiffView diff={diffQuery.data.diff} className="max-w-full" />}
      </ScrollArea>
      <div className="shrink-0 border-t border-border/70 px-3 py-2">
        <Button variant="outline" size="sm" disabled={reverting} onClick={handleRevert} className="w-full">
          <RotateCcwIcon />
          {reverting ? "Reverting…" : "Revert"}
        </Button>
      </div>
    </>
  );

  if (isDesktop) {
    return (
      <aside className={cn("flex min-h-0 flex-col bg-background", className)}>
        <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
          <h2 className="text-sm font-medium text-foreground">History</h2>
          {onClose && (
            <Button variant="ghost" size="icon-sm" aria-label="Close history" onClick={onClose}>
              <XIcon />
            </Button>
          )}
        </div>

        {commitListPanel}

        <div className="flex min-h-0 flex-1 flex-col">
          {!selectedSha && <div className="p-3 text-sm text-muted-foreground">Select a commit to view its diff.</div>}
          {selectedSha && diffPanel}
        </div>
        {setOnlyDialog}
      </aside>
    );
  }

  // Mobile: full-screen sheet over the reader (same pattern as MobileChatDock), with the
  // commit list and the diff as separate screens so the diff always gets the full width.
  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] min-w-0 flex-col bg-background">
      <div
        className="flex items-center justify-between border-b border-border/70 px-3 py-2"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
      >
        {selectedSha ? (
          <Button variant="ghost" size="sm" onClick={() => setSelectedSha(undefined)}>
            <ChevronLeftIcon />
            Commits
          </Button>
        ) : (
          <h2 className="text-sm font-medium text-foreground">History</h2>
        )}
        {onClose && (
          <Button variant="ghost" size="icon-sm" aria-label="Close history" onClick={onClose}>
            <XIcon />
          </Button>
        )}
      </div>

      {!selectedSha && commitListPanel}

      {selectedSha && (
        <div
          className="flex min-h-0 flex-1 min-w-0 flex-col"
          style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
        >
          {diffPanel}
        </div>
      )}
      {setOnlyDialog}
    </div>
  );
}
