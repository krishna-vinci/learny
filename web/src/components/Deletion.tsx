import type { DeletionPreview } from "@studium/shared";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontalIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Spinner } from "@/components/ui/spinner";
import { friendlyMessage } from "@/lib/friendly-errors";
import { exitImmersive } from "@/lib/immersive-store";
import { toast } from "@/lib/notify";
import { cn } from "@/lib/utils";

export function deletionError(error: unknown): string {
  return error instanceof ApiError && [400, 404, 409].includes(error.status)
    ? error.message
    : friendlyMessage(error, "Couldn't delete or restore this item. Try again.");
}

export function LinkedDeletionDetails({ preview }: { preview: DeletionPreview }) {
  return (
    <div className="space-y-2 text-sm text-muted-foreground">
      {(preview.cardFiles > 0 || preview.mediaFiles > 0 || preview.highlights > 0) && (
        <p>
          Also removes{" "}
          {[
            preview.cardFiles ? `${preview.cardFiles} card ${preview.cardFiles === 1 ? "file" : "files"}` : "",
            preview.mediaFiles
              ? `${preview.mediaFiles} media ${preview.mediaFiles === 1 ? "file" : "files"} used only here`
              : "",
            preview.highlights ? "saved highlights" : "",
          ]
            .filter(Boolean)
            .join(", ")}
          . Shared media is kept.
        </p>
      )}
      {preview.exportedCards > 0 && (
        <p>
          {preview.exportedCards} exported {preview.exportedCards === 1 ? "card stays" : "cards stay"} in Anki. To
          remove them, open Browse in Anki, select the cards in this chapter's deck, and delete their notes.
        </p>
      )}
      {preview.retainedIgnoredFiles > 0 && (
        <p>
          {preview.retainedIgnoredFiles}{" "}
          {preview.retainedIgnoredFiles === 1 ? "file outside history stays" : "files outside history stay"} on disk,
          including any chats or originals. Restoring the set makes them available again.
        </p>
      )}
      {preview.practiceHistoryKept && preview.kind === "note" && (
        <p>Past practice stays available, even though its note is removed.</p>
      )}
    </div>
  );
}

export function useRestoreDeleted() {
  const client = useQueryClient();
  async function refresh() {
    await Promise.all(
      ["sets", "recently-deleted", "today", "search", "inbox", "highlights", "practice", "library"].map((key) =>
        client.invalidateQueries({ queryKey: [key] }),
      ),
    );
  }
  async function restore(set: string, sha: string, onRestored?: () => void) {
    try {
      await api.sets.restore(set, sha);
      await refresh();
      onRestored?.();
    } catch (error) {
      toast.error(deletionError(error));
    }
  }
  return { restore, refresh };
}

export function useDeleteNote({
  set,
  path,
  leaveReader = false,
}: {
  set: string;
  path: string;
  leaveReader?: boolean;
}) {
  const navigate = useNavigate();
  const { refresh, restore } = useRestoreDeleted();
  const [pending, setPending] = useState(false);
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [removeFromPlan, setRemoveFromPlan] = useState(false);
  const [error, setError] = useState("");

  async function remove(checked: DeletionPreview, removePlan: boolean) {
    setPending(true);
    try {
      const result = await api.sets.deleteNote(set, {
        path,
        token: checked.token,
        removeFromPlan: removePlan,
        linkedDataConfirmed: true,
      });
      setPreview(null);
      if (leaveReader) {
        exitImmersive();
        navigate(`/s/${set}`);
      }
      await refresh();
      toast.success(`${checked.title} deleted.${checked.chapter && !removePlan ? " Chapter kept in the plan." : ""}`, {
        id: result.sha,
        duration: 8000,
        action: {
          label: "Undo",
          onClick: () =>
            void restore(set, result.sha, () => {
              if (leaveReader) navigate(`/s/${set}/n/${path.replace(/^notes\//, "")}`);
            }),
        },
      });
      return true;
    } catch (err) {
      if (preview) setError(deletionError(err));
      else toast.error(deletionError(err));
      return false;
    } finally {
      setPending(false);
    }
  }
  async function begin(removePlan: boolean) {
    setPending(true);
    setError("");
    try {
      const checked = await api.sets.deletionPreview(set, path);
      setRemoveFromPlan(removePlan);
      if (checked.files > 1) setPreview(checked);
      else await remove(checked, removePlan);
    } catch (err) {
      toast.error(deletionError(err));
    } finally {
      setPending(false);
    }
  }
  return {
    pending,
    items: (
      <>
        <DropdownMenuItem
          disabled={pending}
          className="min-h-11 text-destructive md:min-h-8"
          onClick={() => void begin(false)}
        >
          <Trash2Icon />
          {pending ? "Checking…" : "Delete note"}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={pending}
          className="min-h-11 text-destructive md:min-h-8"
          onClick={() => void begin(true)}
        >
          Delete and remove from plan
        </DropdownMenuItem>
      </>
    ),
    dialog: (
      <ConfirmDialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setPreview(null);
        }}
        title={`Delete ${preview?.title ?? "note"}?`}
        description="You can undo this, or restore it later from Settings → Recently deleted."
        confirmLabel="Delete note"
        confirmVariant="destructive"
        onConfirm={async () => (preview ? remove(preview, removeFromPlan) : false)}
      >
        {preview && (
          <>
            <LinkedDeletionDetails preview={preview} />
            {preview.chapter && (
              <label className="flex min-h-11 items-center gap-2 text-sm text-foreground">
                <input
                  type="checkbox"
                  checked={removeFromPlan}
                  onChange={(event) => setRemoveFromPlan(event.target.checked)}
                />
                Also remove this chapter from the plan
              </label>
            )}
            {preview.chapter && !removeFromPlan && (
              <p className="text-sm text-muted-foreground">
                {preview.chapterBecomesPlanned
                  ? "The chapter becomes planned again, ready to draft."
                  : "Another note keeps this chapter available."}
              </p>
            )}
            {error && (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            )}
          </>
        )}
      </ConfirmDialog>
    ),
  };
}

export function NoteDeletionMenu({ set, path, title }: { set: string; path: string; title: string }) {
  const deletion = useDeleteNote({ set, path });
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          aria-label={`Actions for ${title}`}
          disabled={deletion.pending}
          className={cn(buttonVariants({ variant: "quiet", size: "icon" }), "h-11 w-11 shrink-0")}
        >
          {deletion.pending ? <Spinner aria-label="Checking deletion" /> : <MoreHorizontalIcon />}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>{deletion.items}</DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      {deletion.dialog}
    </>
  );
}

export function DeleteSetControl({ set }: { set: string }) {
  const navigate = useNavigate();
  const { refresh } = useRestoreDeleted();
  const [preview, setPreview] = useState<DeletionPreview | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function begin() {
    setPending(true);
    setError("");
    try {
      setPreview(await api.sets.deletionPreview(set));
    } catch (err) {
      toast.error(deletionError(err));
    } finally {
      setPending(false);
    }
  }
  async function remove() {
    if (!preview) return false;
    setPending(true);
    try {
      await api.sets.deleteSet(set, { token: preview.token, confirmation: preview.title });
      setPreview(null);
      exitImmersive();
      navigate("/sets");
      await refresh();
      toast.success("Study set deleted. You can restore it from Recently deleted.", {
        duration: 8000,
        action: { label: "Open", onClick: () => navigate("/settings/recently-deleted") },
      });
      return true;
    } catch (err) {
      setError(deletionError(err));
      return false;
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="mt-8 flex flex-wrap items-center gap-3 border-t border-border/70 pt-3">
      <Button variant="quiet" className="h-11 text-destructive" disabled={pending} onClick={() => void begin()}>
        <Trash2Icon />
        {pending ? "Checking…" : "Delete study set"}
      </Button>
      <Link
        to="/settings/recently-deleted"
        className="flex min-h-11 items-center text-sm text-muted-foreground hover:text-foreground"
      >
        Recently deleted
      </Link>
      <ConfirmDialog
        open={preview !== null}
        onOpenChange={(open) => {
          if (!open && !pending) setPreview(null);
        }}
        title={`Delete ${preview?.title ?? "study set"}?`}
        description="Removes this set's notes, cards, media and practice. Sources in your Library are kept. Restore it later from Settings → Recently deleted."
        typedConfirmValue={preview?.title}
        confirmLabel="Delete study set"
        confirmVariant="destructive"
        onConfirm={remove}
      >
        {preview && <LinkedDeletionDetails preview={preview} />}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </ConfirmDialog>
    </div>
  );
}
