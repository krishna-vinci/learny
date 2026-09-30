// "Write a note" flow: a title, `POST /api/sets/:set/notes`, then straight into the new
// note with the editor already open (`?edit=1`) so the user can start typing right away.
import { useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useCreateNote } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyMessage } from "@/lib/friendly-errors";
import { toast } from "@/lib/notify";

export interface NewNoteDialogProps {
  set: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewNoteDialog({ set, open, onOpenChange }: NewNoteDialogProps) {
  const [title, setTitle] = useState("");
  const navigate = useNavigate();
  const createNote = useCreateNote(set);

  if (!open) return null;

  function close() {
    if (createNote.isPending) return;
    onOpenChange(false);
    setTitle("");
  }

  async function submit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    try {
      const { path } = await createNote.mutateAsync(trimmedTitle);
      onOpenChange(false);
      setTitle("");
      navigate(`/s/${set}/n/${path.replace(/^notes\//, "")}?edit=1`);
    } catch (err) {
      toast.error(friendlyMessage(err, "Failed to create note."));
    }
  }

  // Portal to <body>: opened from the phone drawer, the drawer's stacking context would
  // otherwise put this sheet under the chat button.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/50 md:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="Write a note"
    >
      <button type="button" aria-label="Close" className="absolute inset-0" onClick={close} />
      <div className="relative flex max-h-[90vh] w-full flex-col overflow-y-auto rounded-t-xl border border-border/70 bg-background p-4 shadow-2xl md:max-w-md md:rounded-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">Write a note</h2>
          <Button variant="quiet" size="sm" onClick={close}>
            Close
          </Button>
        </div>

        <div className="mt-4">
          <Label htmlFor="new-note-title">Title</Label>
          <Input
            id="new-note-title"
            autoFocus
            className="mt-1 h-11 md:h-8"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="e.g. Eigenvalues and eigenvectors"
            required
            onKeyDown={(e) => {
              if (e.key === "Enter" && title.trim()) void submit();
            }}
          />
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            className="h-11 w-full md:h-9 md:w-auto"
            onClick={() => void submit()}
            disabled={!title.trim() || createNote.isPending}
          >
            {createNote.isPending ? "Creating…" : "Create note"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default NewNoteDialog;
