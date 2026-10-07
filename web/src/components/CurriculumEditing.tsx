import type { CurriculumOperation, CurriculumView, PlanProposal, PlanProposalChapter } from "@studium/shared";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontalIcon } from "lucide-react";
import { useState } from "react";
import { ApiError, api } from "@/api/client";
import { queryKeys } from "@/api/queries";
import { ChapterEditSheet } from "@/components/ChapterEditSheet";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "@/lib/notify";

function isFileConflict(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    error.status === 409 &&
    typeof error.body === "object" &&
    error.body !== null &&
    "error" in error.body &&
    error.body.error === "changed"
  );
}

export function useCurriculumEditing(set: string, proposal?: { file: string; data: PlanProposal; reload: () => void }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<{
    view: CurriculumView;
    chapter: PlanProposalChapter | null;
    after: number | null;
  } | null>(null);
  const [deleting, setDeleting] = useState<{ view: CurriculumView; number: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [conflict, setConflict] = useState(false);
  async function refresh() {
    proposal?.reload();
    await Promise.all([
      client.invalidateQueries({ queryKey: queryKeys.course(set) }),
      client.invalidateQueries({ queryKey: queryKeys.notes(set) }),
      client.invalidateQueries({ queryKey: queryKeys.file(set, "curriculum.md") }),
      client.invalidateQueries({ queryKey: queryKeys.inbox(set) }),
    ]);
  }
  async function view(): Promise<CurriculumView> {
    return proposal
      ? { raw: proposal.data.raw ?? "", chapters: proposal.data.chapters ?? [] }
      : api.sets.curriculum(set);
  }
  async function mutate(snapshot: CurriculumView, operation: CurriculumOperation) {
    const result = proposal
      ? await api.inbox.editPlanCurriculum(set, proposal.file, snapshot.raw, operation)
      : await api.sets.editCurriculum(set, snapshot.raw, operation);
    await refresh();
    toast.success(operation.operation === "delete" ? "Chapter removed; your note is kept" : "Plan saved", {
      action: result.sha
        ? {
            label: "Undo",
            onClick: () => {
              void api.sets
                .revert(set, result.sha as string)
                .then(refresh)
                .catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Couldn't undo that."));
            },
          }
        : undefined,
    });
  }
  async function action(kind: "edit" | "insert" | "delete" | "up" | "down", number: number | null) {
    if (busy) return;
    setBusy(true);
    setConflict(false);
    try {
      const snapshot = await view();
      const selected = snapshot.chapters.find((c) => c.number === number) ?? null;
      if (kind === "edit" && !selected)
        throw new Error("This chapter is no longer in the plan. Reload before editing.");
      if (kind === "edit" || kind === "insert")
        setEditing({
          view: snapshot,
          chapter: kind === "edit" ? selected : null,
          after: number,
        });
      else if (kind === "delete" && number !== null) setDeleting({ view: snapshot, number });
      else if (number !== null)
        await mutate(snapshot, { operation: "move", number, direction: kind === "up" ? "up" : "down" });
    } catch (error) {
      if (isFileConflict(error)) setConflict(true);
      else toast.error(error instanceof Error ? error.message : "Couldn't edit the plan.");
    } finally {
      setBusy(false);
    }
  }
  const overlays = (
    <>
      {conflict && !editing && (
        <div role="alert" className="my-2 rounded-md bg-warning/10 p-3 text-sm">
          The plan changed. Reload before editing.{" "}
          <Button
            variant="outline"
            className="h-11"
            onClick={() => {
              setConflict(false);
              setDeleting(null);
              void refresh();
            }}
          >
            Reload
          </Button>
        </div>
      )}
      {editing && (
        <ChapterEditSheet
          chapter={editing.chapter}
          conflict={conflict}
          onClose={() => {
            setEditing(null);
            setConflict(false);
          }}
          onReload={() => {
            setEditing(null);
            setConflict(false);
            void refresh();
          }}
          onSave={async (chapter) => {
            try {
              await mutate(
                editing.view,
                editing.chapter
                  ? { operation: "update", number: editing.chapter.number, chapter }
                  : { operation: "insert", after: editing.after, chapter },
              );
              setEditing(null);
            } catch (error) {
              if (isFileConflict(error)) setConflict(true);
              throw error;
            }
          }}
        />
      )}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title="Delete this chapter?"
        description={
          "Its note will be kept under “Other notes in this set”. Prerequisite references to this chapter will be removed. You can undo this change."
        }
        confirmLabel="Delete chapter"
        confirmVariant="destructive"
        onConfirm={async () => {
          if (!deleting) return;
          try {
            await mutate(deleting.view, { operation: "delete", number: deleting.number });
            setDeleting(null);
          } catch (error) {
            if (isFileConflict(error)) setConflict(true);
            else toast.error(error instanceof Error ? error.message : "Couldn't delete the chapter.");
          }
        }}
      />
    </>
  );
  return { action, overlays, busy };
}

export function ChapterPlanMenu({
  number,
  title,
  first,
  last,
  action,
  children,
}: {
  number: number;
  title: string;
  first: boolean;
  last: boolean;
  action: (kind: "edit" | "insert" | "delete" | "up" | "down", number: number | null) => Promise<void>;
  children?: React.ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="quiet" size="icon" className="size-11" />}
        aria-label={`Actions for ${title}`}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={() => void action("edit", number)}>Edit chapter</DropdownMenuItem>
          <DropdownMenuItem onClick={() => void action("insert", number)}>Add chapter after</DropdownMenuItem>
          <DropdownMenuItem disabled={first} onClick={() => void action("up", number)}>
            Move up
          </DropdownMenuItem>
          <DropdownMenuItem disabled={last} onClick={() => void action("down", number)}>
            Move down
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => void action("delete", number)}>Delete chapter</DropdownMenuItem>
          {children}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
