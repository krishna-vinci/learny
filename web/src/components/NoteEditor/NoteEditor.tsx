import type { FileView } from "@studium/shared";
import { useQueryClient } from "@tanstack/react-query";
import { lazy, Suspense, useState } from "react";
import { createPortal } from "react-dom";
import { ApiError } from "@/api/client";
import { queryKeys, useSaveFile } from "@/api/queries";
import ConfirmDialog from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { friendlyMessage } from "@/lib/friendly-errors";
import { toast } from "@/lib/notify";

/** `PUT /file`'s 409 body (`{ error: "changed", current }`) — see AGENTS.md's API contract. */
function conflictCurrent(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as { error?: unknown; current?: unknown };
  return b.error === "changed" && typeof b.current === "string" ? b.current : null;
}

const CodeMirrorNoteEditor = lazy(() => import("@/components/NoteEditor/CodeMirrorNoteEditor"));

/** CodeMirror editor for a note's exact file text (`FileView.raw`, frontmatter + body),
 * with a plain-textarea fallback while the editor chunk loads and for notes with `\r\n`
 * line endings (CodeMirror normalises those, which would make a save rewrite them); a
 * concurrent change on disk surfaces as `PUT /file`'s 409 conflict. */
export function NoteEditor({
  set,
  path,
  file,
  onDone,
}: {
  set: string;
  path: string;
  file: FileView;
  onDone: () => void;
}) {
  const initial = file.raw;
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(initial);
  const [previous, setPrevious] = useState(initial);
  const [conflict, setConflict] = useState<string | null>(null);
  const saveFile = useSaveFile(set);
  const [saveError, setSaveError] = useState<string | null>(null);
  const dirty = draft !== previous;

  const [discardOpen, setDiscardOpen] = useState(false);

  function cancel() {
    if (dirty) setDiscardOpen(true);
    else onDone();
  }

  async function save(withPrevious: string) {
    setSaveError(null);
    try {
      await saveFile.mutateAsync({ path, content: draft, previous: withPrevious });
      setConflict(null);
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        const current = conflictCurrent(err.body);
        if (current !== null) {
          setConflict(current);
          return;
        }
      }
      const message = err instanceof ApiError ? err.message : friendlyMessage(err, "Failed to save this file.");
      setSaveError(message);
      toast.error(message);
    }
  }

  function reload() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.file(set, path) });
    setConflict(null);
    onDone();
  }

  function overwrite() {
    if (conflict === null) return;
    setPrevious(conflict);
    void save(conflict);
  }

  // A full-screen overlay (`fixed inset-0`), like AddSourceSheet/MobileChatDock's sheets,
  // rather than `sticky top-0 h-dvh` (DesktopChatDock's trick): on phones this editor sits
  // below the mobile header in the document flow, so a flow-relative `h-dvh` block would
  // run `header height` past the bottom of the viewport. `fixed inset-0` is viewport-
  // anchored regardless of ancestors, and — as a side effect — cleanly covers the chat FAB
  // while editing instead of needing separate padding to dodge it.
  return createPortal(
    <div data-note-editor className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col bg-background">
      <ConfirmDialog
        open={discardOpen}
        onOpenChange={setDiscardOpen}
        title="Discard your changes?"
        description="What you typed since the last save will be lost."
        confirmLabel="Discard"
        cancelLabel="Keep editing"
        confirmVariant="destructive"
        onConfirm={onDone}
      />
      <div
        className="flex shrink-0 items-center justify-between gap-2 border-b border-border/70 px-4 py-2"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
      >
        <h1 className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">Editing {path}</h1>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" className="h-11 md:h-7" onClick={cancel} disabled={saveFile.isPending}>
            Cancel
          </Button>
          <Button size="sm" className="h-11 md:h-7" onClick={() => void save(previous)} disabled={saveFile.isPending}>
            {saveFile.isPending ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {conflict !== null && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-warning-ink sm:flex-row sm:items-center sm:justify-between">
          <span>This file changed while you were editing.</span>
          <div className="flex shrink-0 gap-2">
            <Button variant="outline" size="sm" className="h-9" onClick={reload}>
              Reload
            </Button>
            <Button size="sm" className="h-9" onClick={overwrite} disabled={saveFile.isPending}>
              Overwrite
            </Button>
          </div>
        </div>
      )}

      {saveError && (
        <p role="alert" className="px-4 py-2 text-sm text-destructive">
          {saveError}
        </p>
      )}
      <Suspense
        fallback={
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            spellCheck={false}
            className="min-h-0 flex-1 resize-none border-0 bg-background px-4 py-3 font-mono text-sm text-foreground outline-none"
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
          />
        }
      >
        <CodeMirrorNoteEditor set={set} value={draft} onChange={setDraft} />
      </Suspense>
    </div>,
    document.body,
  );
}
