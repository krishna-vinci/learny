// New study set flow: title + optional goal, `POST /api/sets`, then navigate straight
// into the new set. Same overlay pattern as `AddSourceSheet`/`NewChapterSheet` (there's
// no shared dialog primitive in `components/ui` yet — see AGENTS.md, "no new deps").
import { useState } from "react";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import { ApiError } from "@/api/client";
import { useCreateSet } from "@/api/queries";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface NewSetDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function NewSetDialog({ open, onOpenChange }: NewSetDialogProps) {
  const [title, setTitle] = useState("");
  const [goal, setGoal] = useState("");
  const navigate = useNavigate();
  const createSet = useCreateSet();

  if (!open) return null;

  function close() {
    if (createSet.isPending) return;
    onOpenChange(false);
    setTitle("");
    setGoal("");
  }

  async function submit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    try {
      const { slug } = await createSet.mutateAsync({
        title: trimmedTitle,
        ...(goal.trim() ? { goal: goal.trim() } : {}),
      });
      onOpenChange(false);
      setTitle("");
      setGoal("");
      navigate(`/s/${slug}`);
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to create study set.");
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/50 md:items-center"
      role="dialog"
      aria-modal="true"
      aria-label="New study set"
    >
      <button type="button" aria-label="Close" className="absolute inset-0" onClick={close} />
      <div className="relative flex max-h-[90vh] w-full flex-col overflow-y-auto rounded-t-xl border border-border/70 bg-background p-4 shadow-2xl md:max-w-md md:rounded-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">New study set</h2>
          <Button variant="quiet" size="sm" onClick={close}>
            Close
          </Button>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <Label htmlFor="new-set-title">Title</Label>
            <Input
              id="new-set-title"
              autoFocus
              className="mt-1 h-11 md:h-8"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Linear algebra for ML"
              required
              onKeyDown={(e) => {
                if (e.key === "Enter" && title.trim()) void submit();
              }}
            />
          </div>
          <div>
            <Label htmlFor="new-set-goal">Goal (optional)</Label>
            <textarea
              id="new-set-goal"
              className="mt-1 w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground md:text-sm"
              rows={3}
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What are you trying to learn?"
            />
          </div>
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            className="h-11 w-full md:h-9 md:w-auto"
            onClick={() => void submit()}
            disabled={!title.trim() || createSet.isPending}
          >
            {createSet.isPending ? "Creating…" : "Create set"}
          </Button>
        </div>
      </div>
    </div>
  );
}

export default NewSetDialog;
