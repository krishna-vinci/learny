import type { CommitInfo } from "@studium/shared";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { RotateCcwIcon, XIcon } from "lucide-react";
import { useState } from "react";
import toast from "react-hot-toast";
import { api } from "@/api/client";
import { queryKeys } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { DiffView } from "./DiffView";

export interface NoteHistoryProps {
  set: string;
  path: string;
  className?: string;
  onClose?: () => void;
}

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString();
}

/** History panel: commit list (`GET /history`), diff for the selected commit (`GET /diff`),
 * and a revert action (`POST /revert`) that refetches the note, its notes list, and its history. */
export function NoteHistory({ set, path, className, onClose }: NoteHistoryProps) {
  const queryClient = useQueryClient();
  const [selectedSha, setSelectedSha] = useState<string | undefined>(undefined);
  const [reverting, setReverting] = useState(false);

  const historyQuery = useQuery<CommitInfo[]>({
    queryKey: queryKeys.history(set, path),
    queryFn: () => api.sets.history(set, { path }),
  });

  const diffQuery = useQuery<{ diff: string }>({
    queryKey: ["sets", set, "diff", path, selectedSha ?? null],
    queryFn: () => api.sets.diff(set, selectedSha as string, path),
    enabled: !!selectedSha,
  });

  const handleRevert = async () => {
    if (!selectedSha) return;
    setReverting(true);
    try {
      await api.sets.revert(set, selectedSha);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: queryKeys.file(set, path) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.history(set, path) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.notes(set) }),
      ]);
      setSelectedSha(undefined);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Revert failed");
    } finally {
      setReverting(false);
    }
  };

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

      <ScrollArea className="max-h-48 shrink-0 border-b border-border/70">
        {historyQuery.isLoading && <div className="p-3 text-sm text-muted-foreground">Loading…</div>}
        {historyQuery.isError && <div className="p-3 text-sm text-destructive">Failed to load history.</div>}
        {historyQuery.data?.length === 0 && <div className="p-3 text-sm text-muted-foreground">No commits yet.</div>}
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
      </ScrollArea>

      <div className="flex min-h-0 flex-1 flex-col">
        {!selectedSha && <div className="p-3 text-sm text-muted-foreground">Select a commit to view its diff.</div>}
        {selectedSha && (
          <>
            <div className="flex items-center justify-between px-3 py-2">
              <span className="text-xs text-muted-foreground">{selectedSha.slice(0, 7)}</span>
              <Button variant="outline" size="sm" disabled={reverting} onClick={handleRevert}>
                <RotateCcwIcon />
                {reverting ? "Reverting…" : "Revert"}
              </Button>
            </div>
            <ScrollArea className="min-h-0 flex-1 px-3 pb-3">
              {diffQuery.isLoading && <div className="text-sm text-muted-foreground">Loading diff…</div>}
              {diffQuery.isError && <div className="text-sm text-destructive">Failed to load diff.</div>}
              {diffQuery.data && <DiffView diff={diffQuery.data.diff} />}
            </ScrollArea>
          </>
        )}
      </div>
    </aside>
  );
}
