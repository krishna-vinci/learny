// "New chapter" form: drafts a chapter note from library sources via a `draft-chapter`
// job (see `Reader`'s "Make cards" for the sibling flow on an existing note). Extracted
// from InboxPage so SetHomePage and the sidebar's "+" menu can open the same sheet.
import { useState } from "react";
import { createPortal } from "react-dom";
import { toast } from "react-hot-toast";
import { ApiError, api } from "@/api/client";
import { useLibrary } from "@/api/queries";
import { showJobStartedToast } from "@/components/Activity/job-start-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** A minimal source picker for the "New chapter" form: id + title only, via the shared
 * Library query (same one the Library pages use, so results share a cache). */
function useLibrarySourceOptions() {
  const { data } = useLibrary();
  return { data: (data ?? []).map((source) => ({ id: source.id, title: source.title })) };
}

export interface NewChapterSheetProps {
  set: string;
  onClose: () => void;
}

export function NewChapterSheet({ set, onClose }: NewChapterSheetProps) {
  const [title, setTitle] = useState("");
  const [brief, setBrief] = useState("");
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const { data: sources = [] } = useLibrarySourceOptions();

  function toggleSource(id: string) {
    setSelectedSources((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

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
      toast.error(err instanceof ApiError ? err.message : "Failed to start job.");
    } finally {
      setSubmitting(false);
    }
  }

  // Portal to <body>: opened from the phone drawer, the drawer's stacking context would
  // otherwise put this sheet under the chat button.
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-overlay/50 md:items-center">
      <div className="flex max-h-[90vh] w-full flex-col overflow-y-auto rounded-t-xl border border-border/70 bg-background p-4 shadow-2xl md:max-w-lg md:rounded-xl">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-foreground">New chapter</h2>
          <Button variant="quiet" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>

        <div className="mt-4 flex flex-col gap-4">
          <div>
            <Label htmlFor="new-chapter-title">Title</Label>
            <Input
              id="new-chapter-title"
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
          {sources.length > 0 && (
            <div>
              <Label>Sources</Label>
              <ul className="mt-1 max-h-40 overflow-y-auto rounded-md border border-border/70 p-1">
                {sources.map((source) => (
                  <li key={source.id}>
                    <label className="flex min-h-11 cursor-pointer items-center gap-2 rounded px-2 text-sm hover:bg-accent/40 md:min-h-8">
                      <input
                        type="checkbox"
                        checked={selectedSources.includes(source.id)}
                        onChange={() => toggleSource(source.id)}
                      />
                      <span className="min-w-0 flex-1 truncate">{source.title}</span>
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="mt-4 flex justify-end">
          <Button
            className="h-11 w-full md:h-9 md:w-auto"
            onClick={() => void submit()}
            disabled={!title.trim() || submitting}
          >
            {submitting ? "Starting…" : "Start draft job"}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

export default NewChapterSheet;
