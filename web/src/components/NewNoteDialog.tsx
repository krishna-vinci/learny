// "Write a note" flow: a title, `POST /api/sets/:set/notes`, then straight into the new
// note with the editor already open (`?edit=1`) so the user can start typing right away.
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useCreateNote } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Write a note</DialogTitle>
          <DialogDescription>Give it a title. You'll start typing straight away.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div>
            <Label htmlFor="new-note-title">Title</Label>
            <Input
              id="new-note-title"
              autoFocus
              className="mt-1 h-11 md:h-8"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Eigenvalues and eigenvectors"
              required
            />
          </div>
          <Button
            type="submit"
            className="h-11 w-full md:h-9 md:w-auto md:self-end"
            disabled={!title.trim() || createNote.isPending}
          >
            {createNote.isPending ? "Creating…" : "Create note"}
          </Button>
          {!title.trim() && <p className="-mt-2 text-xs text-muted-foreground">Enter a title to continue.</p>}
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default NewNoteDialog;
