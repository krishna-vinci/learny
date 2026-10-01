import type { Highlight, HighlightColor } from "@studium/shared";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { HighlighterIcon, MessageSquareIcon, XIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { api } from "@/api/client";
import { queryKeys } from "@/api/queries";
import { openChatDock } from "@/components/ChatDock/openChatDock";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { friendlyMessage } from "@/lib/friendly-errors";
import { toast } from "@/lib/notify";
import { cn } from "@/lib/utils";
import { articleText, capturePassage, clearHighlights, type PassageSelection, placeHighlights } from "./highlight-dom";
import { MarkdownView } from "./MarkdownView";

const colors: HighlightColor[] = ["yellow", "green", "blue", "pink"];
function ColorPicker({
  onPick,
  disabled,
  current,
}: {
  onPick: (color: HighlightColor) => void;
  disabled?: boolean;
  current?: HighlightColor;
}) {
  return (
    <fieldset className="flex flex-wrap gap-2">
      <legend className="sr-only">Highlight colours</legend>
      {colors.map((color) => (
        <Button
          key={color}
          variant="outline"
          size="sm"
          className={cn("min-h-11 capitalize", `highlight-${color}`)}
          aria-label={`Highlight ${color}`}
          aria-pressed={current === color}
          disabled={disabled}
          onClick={() => onPick(color)}
        >
          {color}
        </Button>
      ))}
    </fieldset>
  );
}

/** The keyed Markdown subtree owns the DOM that we annotate. It remounts when source
 * text changes; mark cleanup happens before another placement and on unmount. */
export function ReaderPassages({
  set,
  path,
  content,
  highlights,
  listOpen,
  onListClose,
  query,
}: {
  set: string;
  path: string;
  content: string;
  highlights: Highlight[];
  listOpen: boolean;
  onListClose: () => void;
  query: string;
}) {
  const root = useRef<HTMLDivElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const [selection, setSelection] = useState<PassageSelection | null>(null);
  const [askPassage, setAskPassage] = useState<PassageSelection | null>(null);
  const [question, setQuestion] = useState("");
  const [colorOpen, setColorOpen] = useState(false);
  const [unplaced, setUnplaced] = useState<string[]>([]);
  const [editing, setEditing] = useState<Highlight | null>(null);
  const [comment, setComment] = useState("");
  const desktop = useMediaQuery("(min-width: 768px)");
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async (
      action:
        | { kind: "create"; color: HighlightColor; passage: PassageSelection }
        | { kind: "update"; id: string; color?: HighlightColor; comment?: string }
        | { kind: "delete"; id: string; highlight: Highlight },
    ) => {
      if (action.kind === "create")
        return api.highlights.create(set, {
          note: path,
          quote: action.passage.quote,
          prefix: action.passage.prefix,
          suffix: action.passage.suffix,
          color: action.color,
        });
      if (action.kind === "update")
        return api.highlights.update(set, action.id, { note: path, color: action.color, comment: action.comment });
      return api.highlights.delete(set, action.id, path);
    },
    // Optimistic: the highlight appears, changes or disappears immediately; a failure rolls it back.
    onMutate: async (action) => {
      const key = queryKeys.highlights(set, path);
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<{ highlights: Highlight[] }>(key);
      if (previous) {
        const list = previous.highlights;
        const next =
          action.kind === "create"
            ? [
                ...list,
                {
                  id: `pending-${Date.now()}`,
                  quote: action.passage.quote,
                  prefix: action.passage.prefix,
                  suffix: action.passage.suffix,
                  color: action.color,
                  createdAt: new Date().toISOString(),
                },
              ]
            : action.kind === "delete"
              ? list.filter((item) => item.id !== action.id)
              : list.map((item) =>
                  item.id === action.id
                    ? {
                        ...item,
                        ...(action.color ? { color: action.color } : {}),
                        ...(action.comment !== undefined ? { note: action.comment } : {}),
                      }
                    : item,
                );
        queryClient.setQueryData(key, { highlights: next });
      }
      if (action.kind === "create") {
        setSelection(null);
        window.getSelection()?.removeAllRanges();
      }
      if (action.kind === "delete" || (action.kind === "update" && action.comment !== undefined)) setEditing(null);
      return { previous };
    },
    onSuccess: (_, action) => {
      if (action.kind === "update" && action.color)
        setEditing((current) => (current ? { ...current, color: action.color ?? current.color } : null));
      if (action.kind === "delete") {
        const { highlight } = action;
        toast.success("Highlight deleted", {
          action: {
            label: "Undo",
            onClick: () => {
              api.highlights
                .create(set, {
                  note: path,
                  quote: highlight.quote,
                  prefix: highlight.prefix,
                  suffix: highlight.suffix,
                  color: highlight.color,
                })
                .then(({ highlight: restored }) =>
                  highlight.note
                    ? api.highlights.update(set, restored.id, { note: path, comment: highlight.note })
                    : undefined,
                )
                .then(() => queryClient.invalidateQueries({ queryKey: queryKeys.highlights(set, path) }))
                .catch((err: unknown) => toast.error(friendlyMessage(err, "Couldn't undo that.")));
            },
          },
        });
      }
    },
    onError: (error, _action, context) => {
      if (context?.previous) queryClient.setQueryData(queryKeys.highlights(set, path), context.previous);
      toast.error(friendlyMessage(error, "Couldn't save that highlight. Try again."));
    },
    onSettled: () => void queryClient.invalidateQueries({ queryKey: queryKeys.highlights(set, path) }),
  });
  useEffect(() => {
    const element = root.current;
    if (!element) return;
    setUnplaced(placeHighlights(element, highlights));
    return () => clearHighlights(element);
  }, [highlights]);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const inspect = (event: Event) => {
      if (event.target instanceof Node && toolbar.current?.contains(event.target)) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (toolbar.current?.contains(document.activeElement)) return;
        if (root.current) {
          setSelection(capturePassage(root.current));
          setColorOpen(false);
        }
      }, 120);
    };
    const hide = () => {
      clearTimeout(timer);
      setSelection(null);
      setColorOpen(false);
    };
    const pointer = (event: PointerEvent) => {
      if (toolbar.current?.contains(event.target as Node) || root.current?.contains(event.target as Node)) return;
      hide();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") hide();
    };
    document.addEventListener("selectionchange", inspect);
    document.addEventListener("mouseup", inspect);
    document.addEventListener("touchend", inspect);
    document.addEventListener("pointerdown", pointer);
    window.addEventListener("scroll", hide, true);
    window.addEventListener("keydown", key);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("selectionchange", inspect);
      document.removeEventListener("mouseup", inspect);
      document.removeEventListener("touchend", inspect);
      document.removeEventListener("pointerdown", pointer);
      window.removeEventListener("scroll", hide, true);
      window.removeEventListener("keydown", key);
    };
  }, []);
  useEffect(() => {
    if (!query || !root.current) return;
    const element = root.current;
    let flashed: HTMLElement | null = null;
    let clear: ReturnType<typeof setTimeout>;
    const timer = setTimeout(() => {
      const { text, pieces } = articleText(element);
      const needle = query.trim().replace(/^"|"$/g, "").toLowerCase();
      let at = text.toLowerCase().indexOf(needle);
      if (at < 0)
        for (const word of needle.split(/\s+/)) {
          at = text.toLowerCase().indexOf(word);
          if (at >= 0) break;
        }
      const piece = pieces.find((candidate) => candidate.start <= at && candidate.end > at);
      if (!piece) return;
      flashed =
        piece.node.parentElement?.closest<HTMLElement>("p, li, h1, h2, h3, blockquote") ?? piece.node.parentElement;
      flashed?.scrollIntoView({ block: "center" });
      flashed?.classList.add("reader-search-match");
      clear = setTimeout(() => flashed?.classList.remove("reader-search-match"), 2200);
    }, 150);
    return () => {
      clearTimeout(timer);
      clearTimeout(clear);
      flashed?.classList.remove("reader-search-match");
    };
  }, [query]);
  function edit(highlight: Highlight) {
    setEditing(highlight);
    setComment(highlight.note ?? "");
    setSelection(null);
  }
  function send(text: string, passage: PassageSelection) {
    if (passage.quote.length > 4000) {
      toast.error("Select a shorter passage (up to 4,000 characters) to ask about.");
      return;
    }
    setSelection(null);
    setAskPassage(null);
    window.getSelection()?.removeAllRanges();
    openChatDock({ set, text, anchor: path, quote: passage.quote });
  }
  function jump(highlight: Highlight) {
    const mark = [...(root.current?.querySelectorAll<HTMLElement>("[data-highlight-id]") ?? [])].find(
      (element) => element.dataset.highlightId === highlight.id,
    );
    onListClose();
    setTimeout(() => {
      if (mark) {
        mark.scrollIntoView({ block: "center" });
        mark.focus({ preventScroll: true });
      } else edit(highlight);
    }, 150);
  }
  const unplacedHighlights = highlights.filter((highlight) => unplaced.includes(highlight.id));
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: delegates mouse and keyboard events from focusable annotated marks, while keeping prose semantic. */}
      <div
        ref={root}
        data-reader-content
        onClick={(event) => {
          const mark = (event.target as HTMLElement).closest<HTMLElement>("[data-highlight-id]");
          if (!mark || !window.getSelection()?.isCollapsed) return;
          const highlight = highlights.find((item) => item.id === mark.dataset.highlightId);
          if (highlight) {
            event.preventDefault();
            edit(highlight);
          }
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter" && event.key !== " ") return;
          const mark = (event.target as HTMLElement).closest<HTMLElement>("[data-highlight-id]");
          const highlight = highlights.find((item) => item.id === mark?.dataset.highlightId);
          if (highlight) {
            event.preventDefault();
            edit(highlight);
          }
        }}
      >
        <MarkdownView content={content} notePath={`${set}/${path}`} />
      </div>
      {unplacedHighlights.length > 0 && (
        <section className="mt-6 border-t border-border pt-4">
          <h2 className="text-sm font-semibold">Unplaced highlights</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These passages changed or include math or code. Your highlights are still saved.
          </p>
          {unplacedHighlights.map((highlight) => (
            <Button
              key={highlight.id}
              variant="quiet"
              className="mt-2 h-auto min-h-11 w-full justify-start whitespace-normal text-start"
              onClick={() => edit(highlight)}
            >
              {highlight.quote}
            </Button>
          ))}
        </section>
      )}
      {selection &&
        !askPassage &&
        !editing &&
        createPortal(
          <div
            ref={toolbar}
            role="toolbar"
            aria-label="Selected passage actions"
            className={cn(
              "fixed z-50 flex flex-col gap-2 border border-border bg-popover p-2 text-popover-foreground shadow-float",
              desktop ? "w-[400px] rounded-lg" : "inset-x-0 bottom-0 pb-[calc(env(safe-area-inset-bottom,0px)+0.5rem)]",
            )}
            style={
              desktop
                ? {
                    left: Math.max(
                      8,
                      Math.min(selection.rect.left + selection.rect.width / 2 - 200, window.innerWidth - 408),
                    ),
                    top: Math.max(8, selection.rect.top - (colorOpen ? 132 : 62)),
                  }
                : undefined
            }
            onMouseDown={(event) => event.preventDefault()}
          >
            <div className="flex flex-wrap items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11"
                onClick={() => {
                  setAskPassage(selection);
                  setQuestion("");
                  setSelection(null);
                }}
              >
                <MessageSquareIcon />
                Ask
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11"
                onClick={() => send("Explain this passage more simply, for my level.", selection)}
              >
                Explain simpler
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="min-h-11"
                onClick={() => send("Make a card from this passage", selection)}
              >
                Make a card
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label="Highlight selection"
                onClick={() => {
                  if (!selection.canHighlight) {
                    toast.error(
                      selection.quote.length > 2000
                        ? "Select up to 2,000 characters to highlight."
                        : "Highlights work on prose. Select text outside math, code or diagrams.",
                    );
                    return;
                  }
                  setColorOpen(!colorOpen);
                }}
              >
                <HighlighterIcon />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="size-11"
                aria-label="Dismiss selection actions"
                onClick={() => setSelection(null)}
              >
                <XIcon />
              </Button>
            </div>
            {colorOpen && (
              <ColorPicker
                disabled={mutation.isPending}
                onPick={(color) => mutation.mutate({ kind: "create", passage: selection, color })}
              />
            )}
          </div>,
          document.body,
        )}
      <Dialog
        open={!!askPassage}
        onOpenChange={(open) => {
          if (!open) setAskPassage(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Ask about this passage</DialogTitle>
          <DialogDescription className="line-clamp-4">{askPassage?.quote}</DialogDescription>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (askPassage && question.trim()) send(question.trim(), askPassage);
            }}
          >
            <Label htmlFor="passage-question">Your question</Label>
            <Input
              id="passage-question"
              value={question}
              onChange={(event) => setQuestion(event.target.value)}
              placeholder="What would you like to understand?"
            />
            <div className="flex flex-wrap gap-2">
              {["Explain this", "Give an example", "Why?"].map((text) => (
                <Button
                  key={text}
                  variant="outline"
                  className="min-h-11"
                  onClick={() => {
                    if (askPassage) send(text, askPassage);
                  }}
                >
                  {text}
                </Button>
              ))}
            </div>
            <Button type="submit" className="min-h-11" disabled={!question.trim()}>
              Ask tutor
            </Button>
          </form>
        </DialogContent>
      </Dialog>
      <Dialog
        open={listOpen}
        onOpenChange={(open) => {
          if (!open) onListClose();
        }}
      >
        <DialogContent className="max-sm:inset-0 h-dvh max-h-dvh rounded-none pt-[calc(env(safe-area-inset-top,0px)+1rem)] sm:inset-x-auto sm:start-1/2 sm:h-auto sm:max-h-[80dvh] sm:rounded-xl sm:p-5">
          <DialogTitle>Highlights ({highlights.length})</DialogTitle>
          <DialogDescription>Choose a passage to jump to it. Unplaced passages can still be edited.</DialogDescription>
          <div className="min-h-0 overflow-y-auto">
            {highlights.length === 0 && (
              <p className="py-4 text-sm text-muted-foreground">
                Select a passage and choose Highlight to save it here.
              </p>
            )}
            {highlights.map((highlight) => (
              <button
                key={highlight.id}
                type="button"
                className="mb-2 flex min-h-11 w-full flex-col gap-2 rounded-lg border border-border p-3 text-start hover:bg-accent/40 focus-visible:outline-2 focus-visible:outline-ring"
                onClick={() => jump(highlight)}
              >
                <span className={cn("rounded px-1 text-sm", `highlight-${highlight.color}`)}>{highlight.quote}</span>
                {highlight.note && <span className="text-sm text-muted-foreground">{highlight.note}</span>}
                {unplaced.includes(highlight.id) && (
                  <span className="text-xs text-muted-foreground">Unplaced · edit highlight</span>
                )}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!editing}
        onOpenChange={(open) => {
          if (!open) setEditing(null);
        }}
      >
        <DialogContent>
          <DialogTitle>Edit highlight</DialogTitle>
          <DialogDescription className="line-clamp-4">{editing?.quote}</DialogDescription>
          <ColorPicker
            disabled={mutation.isPending}
            current={editing?.color}
            onPick={(color) => {
              if (editing) mutation.mutate({ kind: "update", id: editing.id, color });
            }}
          />
          <Label htmlFor="highlight-comment">Comment</Label>
          <Input
            id="highlight-comment"
            maxLength={1000}
            value={comment}
            onChange={(event) => setComment(event.target.value)}
            placeholder="Add a thought…"
          />
          <div className="flex justify-between gap-2">
            <Button
              variant="outline"
              className="min-h-11 text-destructive"
              disabled={mutation.isPending}
              onClick={() => {
                if (editing) mutation.mutate({ kind: "delete", id: editing.id, highlight: editing });
              }}
            >
              Delete highlight
            </Button>
            <Button
              className="min-h-11"
              disabled={mutation.isPending}
              onClick={() => {
                if (editing) mutation.mutate({ kind: "update", id: editing.id, comment });
              }}
            >
              Save comment
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
