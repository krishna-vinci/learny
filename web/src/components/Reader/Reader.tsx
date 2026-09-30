import type { FileView } from "@studium/shared";
import { HistoryIcon, LayersIcon, PencilIcon } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "react-hot-toast";
import { useSearchParams } from "react-router-dom";
import { ApiError, api } from "@/api/client";
import { useSaveFile } from "@/api/queries";
import { showJobStartedToast } from "@/components/Activity/job-start-toast";
import { NoteHistory } from "@/components/NoteHistory";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MarkdownView } from "./MarkdownView";

export interface ReaderProps {
  set: string;
  path: string;
  file: FileView;
  className?: string;
}

function titleFromFrontmatter(file: FileView): string {
  const title = file.frontmatter?.title;
  return typeof title === "string" && title.trim() ? title : file.path;
}

/** `PUT /file`'s 409 body (`{ error: "changed", current }`) — see AGENTS.md's API contract. */
function conflictCurrent(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const b = body as { error?: unknown; current?: unknown };
  return b.error === "changed" && typeof b.current === "string" ? b.current : null;
}

/** Plain-textarea editor for a note's exact file text (`FileView.raw`, frontmatter + body);
 * a concurrent change on disk surfaces as `PUT /file`'s 409 conflict. */
function NoteEditor({ set, path, file, onDone }: { set: string; path: string; file: FileView; onDone: () => void }) {
  const initial = file.raw;
  const [draft, setDraft] = useState(initial);
  const [previous, setPrevious] = useState(initial);
  const [conflict, setConflict] = useState<string | null>(null);
  const saveFile = useSaveFile(set);
  const dirty = draft !== previous;

  function cancel() {
    if (dirty && !confirm("Discard your changes?")) return;
    onDone();
  }

  async function save(withPrevious: string) {
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
      toast.error(err instanceof ApiError ? err.message : "Failed to save this note.");
    }
  }

  function reload() {
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
  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] w-full flex-col bg-background">
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
        <div className="flex shrink-0 flex-col gap-2 border-b border-warning/40 bg-warning/10 px-4 py-2.5 text-sm text-warning-foreground sm:flex-row sm:items-center sm:justify-between">
          <span>This note changed while you were editing.</span>
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

      <textarea
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        spellCheck={false}
        className="min-h-0 flex-1 resize-none border-0 bg-background px-4 py-3 font-mono text-sm text-foreground outline-none"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 1rem)" }}
      />
    </div>
  );
}

/** The note reader: title + rendered body, with a history panel toggled from the note header
 * (`GET /history`, `GET /diff`, `POST /revert` — see `NoteHistory`). */
export function Reader({ set, path, file, className }: ReaderProps) {
  const [searchParams, setSearchParams] = useSearchParams();
  const commitParam = searchParams.get("commit") ?? undefined;
  const [historyOpen, setHistoryOpen] = useState(!!commitParam);
  const [makingCards, setMakingCards] = useState(false);
  // `?edit=1` (from NewNoteDialog, so a freshly created blank note opens straight into
  // the editor) starts editing immediately; otherwise the reader starts read-only.
  const [editing, setEditing] = useState(() => searchParams.get("edit") === "1");

  async function makeCards() {
    setMakingCards(true);
    try {
      await api.jobs.create({ kind: "make-cards", set, note: path });
      showJobStartedToast(titleFromFrontmatter(file));
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : "Failed to start the cards job.");
    } finally {
      setMakingCards(false);
    }
  }
  // A chat "view diff" link (`?commit=<sha>`) should open history with that commit selected,
  // even if it's navigated to while already on this note's route.
  useEffect(() => {
    if (commitParam) setHistoryOpen(true);
  }, [commitParam]);
  // Notes usually open with their own `# Title`; only show the frontmatter title when they don't.
  const bodyHasTitle = /^\s*#\s/.test(file.body);

  const closeHistory = () => {
    setHistoryOpen(false);
    if (commitParam) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("commit");
          return next;
        },
        { replace: true },
      );
    }
  };

  const stopEditing = () => {
    setEditing(false);
    if (searchParams.has("edit")) {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.delete("edit");
          return next;
        },
        { replace: true },
      );
    }
  };

  if (editing) {
    return <NoteEditor set={set} path={path} file={file} onDone={stopEditing} />;
  }

  return (
    <div className={cn("flex min-h-full w-full items-stretch", className)}>
      <article className="min-w-0 flex-1 px-4 py-4 md:px-6 md:py-6">
        <div className="mx-auto w-full max-w-3xl">
          {/* Phone: the toolbar gets its own row, since floating it beside the title clips it. */}
          <div
            className={cn(
              "flex flex-wrap items-start gap-2 md:gap-4",
              bodyHasTitle ? "mb-3 justify-end md:float-right md:ms-4 md:mb-2" : "mb-4 justify-between",
            )}
          >
            {!bodyHasTitle && <h1 className="text-2xl font-semibold text-foreground">{titleFromFrontmatter(file)}</h1>}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => setEditing(true)}>
                <PencilIcon />
                Edit
              </Button>
              <Button variant="outline" size="sm" onClick={() => void makeCards()} disabled={makingCards}>
                <LayersIcon />
                {makingCards ? "Starting…" : "Make cards"}
              </Button>
              <Button
                variant={historyOpen ? "secondary" : "outline"}
                size="sm"
                aria-pressed={historyOpen}
                onClick={() => (historyOpen ? closeHistory() : setHistoryOpen(true))}
              >
                <HistoryIcon />
                History
              </Button>
            </div>
          </div>
          <MarkdownView content={file.body} />
        </div>
      </article>
      {historyOpen && (
        <NoteHistory
          set={set}
          path={path}
          initialSha={commitParam}
          // Phone: full-screen sheet over the note (a side column would squeeze the text).
          className="fixed inset-0 z-50 overflow-y-auto bg-background pt-[env(safe-area-inset-top)] md:static md:z-auto md:w-80 md:shrink-0 md:overflow-visible md:border-s md:border-border/70 md:pt-0"
          onClose={closeHistory}
        />
      )}
    </div>
  );
}
