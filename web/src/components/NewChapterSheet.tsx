// "New chapter" form: drafts a chapter note from library sources via a `draft-chapter`
// job (see `Reader`'s "Make cards" for the sibling flow on an existing note). Extracted
// from InboxPage so SetHomePage and the sidebar's "+" menu can open the same sheet.
import { useState } from "react";
import { api } from "@/api/client";
import { showJobStartedToast } from "@/components/Activity/job-start-toast";
import { SourcePicker } from "@/components/SourcePicker";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { friendlyMessage } from "@/lib/friendly-errors";
import { toast } from "@/lib/notify";

export interface NewChapterSheetProps {
  set: string;
  /** Prefills the title, e.g. the next chapter of the plan. */
  initialTitle?: string;
  onClose: () => void;
}

export function NewChapterSheet({ set, initialTitle, onClose }: NewChapterSheetProps) {
  const [title, setTitle] = useState(initialTitle ?? "");
  const [brief, setBrief] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  async function submit() {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) return;
    setSubmitting(true);
    try {
      await api.jobs.create({
        kind: "draft-chapter",
        set,
        title: trimmedTitle,
        ...(brief.trim() ? { brief: brief.trim() } : {}),
        ...(selectedSources.length > 0 ? { sources: selectedSources } : {}),
      });
      showJobStartedToast(trimmedTitle);
      onClose();
    } catch (err) {
      toast.error(friendlyMessage(err, "Failed to start job."));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New chapter</DialogTitle>
          <DialogDescription>The assistant writes it from your sources and checks it.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <div>
            <Label htmlFor="new-chapter-title">Title</Label>
            <Input
              id="new-chapter-title"
              autoFocus
              className="mt-1 h-11 md:h-8"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Singular value decomposition"
              required
            />
          </div>
          <div>
            <Label htmlFor="new-chapter-brief">Brief</Label>
            <textarea
              id="new-chapter-brief"
              className="mt-1 w-full resize-none rounded-md border border-border bg-transparent px-3 py-2 text-base outline-none placeholder:text-muted-foreground md:text-sm"
              rows={4}
              value={brief}
              onChange={(e) => setBrief(e.target.value)}
              placeholder="What should this chapter cover?"
            />
          </div>
          <SourcePicker set={set} selected={selectedSources} onChange={setSelectedSources} />
          <Button
            type="submit"
            className="h-11 w-full md:h-9 md:w-auto md:self-end"
            disabled={!title.trim() || submitting}
          >
            {submitting ? "Starting…" : "Write chapter"}
          </Button>
          {!title.trim() && <p className="-mt-2 text-xs text-muted-foreground">Enter a title to continue.</p>}
        </form>
      </DialogContent>
    </Dialog>
  );
}

export default NewChapterSheet;
