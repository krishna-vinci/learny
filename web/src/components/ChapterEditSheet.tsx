import type { ChapterEdit, PlanProposalChapter } from "@studium/shared";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const FORMS = [
  "function-plot",
  "matrix-transform",
  "step-through",
  "timeline",
  "sketch",
  "svg sketch",
  "p5 sketch",
  "d3 sketch",
  "story",
  "svg story",
  "diagram",
  "chart",
  "figure",
  "storyboard",
  "histogram",
  "no interactive visual",
];
const textareaClass =
  "mt-1 w-full rounded-md border border-border bg-transparent px-3 py-2 text-base outline-none md:text-sm";

function splitVisual(intent: string): { form: string; concept: string } {
  const match = /^(.*?)\s*[—–]\s*(.*)$/.exec(intent);
  if (match) return { form: match[1]?.trim() ?? "diagram", concept: match[2] ?? "" };
  if (/^no interactive visual:/i.test(intent))
    return { form: "no interactive visual", concept: intent.replace(/^no interactive visual:\s*/i, "") };
  return { form: "custom", concept: intent };
}

export function ChapterEditSheet({
  chapter,
  onSave,
  onClose,
  conflict,
  onReload,
}: {
  chapter: PlanProposalChapter | null;
  onSave: (edit: ChapterEdit) => Promise<void>;
  onClose: () => void;
  conflict: boolean;
  onReload: () => void;
}) {
  const [title, setTitle] = useState(chapter?.title ?? "");
  const [scope, setScope] = useState(chapter?.scope ?? "");
  const [prerequisites, setPrerequisites] = useState(chapter?.prerequisites ?? "none");
  const [video, setVideo] = useState(chapter?.video ?? "");
  const [visuals, setVisuals] = useState(() => (chapter?.visuals ?? []).map((v, id) => ({ ...splitVisual(v), id })));
  const [nextId, setNextId] = useState(visuals.length);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save() {
    setSaving(true);
    setError(null);
    try {
      await onSave({
        title: title.trim(),
        scope: scope.trim(),
        prerequisites: prerequisites.trim() || "none",
        video: video.trim(),
        visuals: visuals.map((v) =>
          v.form === "custom"
            ? v.concept
            : v.form === "no interactive visual"
              ? `${v.form}: ${v.concept.trim()}`
              : `${v.form} — ${v.concept.trim()}`,
        ),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save this chapter.");
    } finally {
      setSaving(false);
    }
  }
  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{chapter ? "Edit chapter" : "Add chapter"}</DialogTitle>
          <DialogDescription>
            Keep the rest of your course as it is. Prerequisites use the current chapter numbers.
          </DialogDescription>
        </DialogHeader>
        {conflict && (
          <div role="alert" className="rounded-md bg-warning/10 p-3 text-sm">
            The plan changed while you were editing.{" "}
            <Button variant="outline" className="h-11" onClick={onReload}>
              Reload
            </Button>
          </div>
        )}
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <div>
            <Label htmlFor="chapter-edit-title">Title</Label>
            <Input
              id="chapter-edit-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              required
              maxLength={200}
              className="mt-1 h-11"
            />
          </div>
          <div>
            <Label htmlFor="chapter-edit-scope">Scope</Label>
            <textarea
              id="chapter-edit-scope"
              value={scope}
              onChange={(e) => setScope(e.target.value.replace(/\r?\n/g, " "))}
              required
              rows={3}
              className={textareaClass}
            />
          </div>
          <div>
            <Label htmlFor="chapter-edit-prerequisites">Prerequisites</Label>
            <Input
              id="chapter-edit-prerequisites"
              value={prerequisites}
              onChange={(e) => setPrerequisites(e.target.value)}
              placeholder="none, or 01, 02"
              className="mt-1 h-11"
            />
            <p className="mt-1 text-xs text-muted-foreground">Earlier chapters only. Example: 01, 02</p>
          </div>
          <fieldset className="flex min-w-0 flex-col gap-2">
            <legend className="text-sm font-medium">Visuals</legend>
            {visuals.map((visual, index) => (
              <div key={visual.id} className="flex flex-col gap-2 border-b border-border pb-3">
                <div className="flex items-center gap-2">
                  <label htmlFor={`visual-form-${visual.id}`} className="sr-only">
                    Visual {index + 1} form
                  </label>
                  <select
                    id={`visual-form-${visual.id}`}
                    className="h-11 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-base"
                    value={visual.form}
                    onChange={(e) =>
                      setVisuals((old) => old.map((v) => (v.id === visual.id ? { ...v, form: e.target.value } : v)))
                    }
                  >
                    {!FORMS.includes(visual.form) && (
                      <option value={visual.form}>{visual.form === "custom" ? "Original text" : visual.form}</option>
                    )}
                    {FORMS.map((form) => (
                      <option key={form} value={form}>
                        {form}
                      </option>
                    ))}
                  </select>
                  <Button
                    type="button"
                    variant="quiet"
                    className="h-11"
                    aria-label={`Remove visual ${index + 1}`}
                    onClick={() => setVisuals((old) => old.filter((v) => v.id !== visual.id))}
                  >
                    Remove
                  </Button>
                </div>
                <label htmlFor={`visual-concept-${visual.id}`} className="sr-only">
                  Visual {index + 1} concept
                </label>
                <Input
                  id={`visual-concept-${visual.id}`}
                  value={visual.concept}
                  required
                  placeholder="Concept and what the learner can try"
                  className="h-11"
                  onChange={(e) =>
                    setVisuals((old) => old.map((v) => (v.id === visual.id ? { ...v, concept: e.target.value } : v)))
                  }
                />
              </div>
            ))}
            <Button
              type="button"
              variant="outline"
              className="h-11 self-start"
              disabled={visuals.length >= 20}
              onClick={() => {
                setVisuals((old) => [...old, { id: nextId, form: "step-through", concept: "" }]);
                setNextId((id) => id + 1);
              }}
            >
              Add visual
            </Button>
          </fieldset>
          <div>
            <Label htmlFor="chapter-edit-video">Video</Label>
            <Input
              id="chapter-edit-video"
              value={video}
              onChange={(e) => setVideo(e.target.value)}
              className="mt-1 h-11"
              placeholder="What should a video show?"
            />
          </div>
          {error && !conflict && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex gap-2">
            <Button type="button" variant="outline" className="h-11 flex-1" disabled={saving} onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              className="h-11 flex-1"
              disabled={saving || conflict || !title.trim() || !scope.trim()}
            >
              {saving ? "Saving…" : "Save chapter"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
