import { Tabs } from "@base-ui/react/tabs";
import type { FileView } from "@studium/shared";
import { chapterVisuals } from "@studium/shared/chapter-visuals";
import {
  HighlighterIcon,
  HistoryIcon,
  LayersIcon,
  Maximize2Icon,
  Minimize2Icon,
  MoreHorizontalIcon,
  PencilIcon,
  RefreshCwIcon,
} from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/api/client";
import { useHighlights, useNotes } from "@/api/queries";
import { showJobStartedToast } from "@/components/Activity/job-start-toast";
import { useDeleteNote } from "@/components/Deletion";
import { FirstUseHint } from "@/components/FirstUseHint";
import { NoteEditor } from "@/components/NoteEditor/NoteEditor";
import { NoteHistory } from "@/components/NoteHistory";
import { RewriteChapterDialog } from "@/components/RewriteChapterDialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { friendlyMessage } from "@/lib/friendly-errors";
import { exitImmersive, isImmersive, toggleImmersive, useImmersive } from "@/lib/immersive-store";
import { toast } from "@/lib/notify";
import { readingPrefsVars, useReadingPrefs } from "@/lib/reading-prefs";
import { readScrollPosition, saveScrollPosition } from "@/lib/scroll-memory";
import { useHideOnScroll } from "@/lib/use-hide-on-scroll";
import { cn } from "@/lib/utils";
import { ImmersiveExitButton } from "./ImmersiveExitButton";
import { ReaderPassages } from "./ReaderPassages";
import { ReadingSettingsControl } from "./ReadingSettings";
import { VisualsWhisper } from "./VisualsWhisper";

const ChapterVisuals = lazy(() => import("./ChapterVisuals").then((module) => ({ default: module.ChapterVisuals })));

const EMPTY_HIGHLIGHTS: import("@studium/shared").Highlight[] = [];

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

/** The note reader: title + rendered body, with a history panel toggled from the note header
 * (`GET /history`, `GET /diff`, `POST /revert` — see `NoteHistory`), the reading-comfort
 * settings (B1), immersive full screen (B2) and per-note scroll restore (B3). */
export function Reader({ set, path, file, className }: ReaderProps) {
  const deletion = useDeleteNote({ set, path, leaveReader: true });
  const [searchParams, setSearchParams] = useSearchParams();
  const visualsOpen = searchParams.get("view") === "visuals";
  // Chapter number comes from the plan (NoteSummary.number); unplanned notes show none.
  const notes = useNotes(set).data;
  const chapterNumber = Array.isArray(notes) ? notes.find((note) => note.path === path)?.number : undefined;
  const numberEyebrow = chapterNumber != null && (
    <p className="mb-1 text-sm font-medium text-muted-foreground" data-testid="chapter-number">
      Chapter {chapterNumber}
    </p>
  );
  const chapter = useMemo(() => chapterVisuals(file.body, `${set}/${path}`), [file.body, set, path]);
  function changeView(view: string) {
    if (!visualsOpen) saveScrollPosition(set, path, window.scrollY);
    setHighlightsOpen(false);
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (view === "visuals") next.set("view", "visuals");
        else next.delete("view");
        return next;
      },
      { preventScrollReset: true },
    );
  }
  const commitParam = searchParams.get("commit") ?? undefined;
  const [historyOpen, setHistoryOpen] = useState(!!commitParam);
  const [highlightsOpen, setHighlightsOpen] = useState(false);
  const highlightsQuery = useHighlights(set, path);
  const highlights = highlightsQuery.data?.highlights ?? EMPTY_HIGHLIGHTS;
  const [rewriteOpen, setRewriteOpen] = useState(false);
  const [makingCards, setMakingCards] = useState(false);
  // `?edit=1` (from NewNoteDialog, so a freshly created blank note opens straight into
  // the editor) starts editing immediately; otherwise the reader starts read-only.
  const [editing, setEditing] = useState(() => searchParams.get("edit") === "1");
  const prefs = useReadingPrefs();
  const immersive = useImmersive();
  const toolbarHidden = useHideOnScroll(true);
  const isDesktop = useMediaQuery("(min-width: 768px)");

  async function makeCards() {
    setMakingCards(true);
    try {
      await api.jobs.create({ kind: "make-cards", set, note: path });
      showJobStartedToast(titleFromFrontmatter(file));
    } catch (err) {
      toast.error(friendlyMessage(err, "Failed to start the cards job."));
    } finally {
      setMakingCards(false);
    }
  }
  // A chat "view diff" link (`?commit=<sha>`) should open history with that commit selected,
  // even if it's navigated to while already on this note's route.
  useEffect(() => {
    if (commitParam) setHistoryOpen(true);
  }, [commitParam]);

  // B2: `f` toggles immersive on desktop; Esc exits when the browser doesn't own the
  // fullscreen (the CSS-only fallback). Typing targets keep their keys.
  useEffect(() => {
    if (!isDesktop) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
      if (event.key === "f") {
        event.preventDefault();
        toggleImmersive();
      } else if (event.key === "Escape" && isImmersive()) {
        exitImmersive();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isDesktop]);

  // Immersive is a reading mode: leave it when the reader goes away (navigating off the
  // note) or when the note opens into the editor.
  useEffect(() => {
    if (editing) exitImmersive();
  }, [editing]);
  useEffect(() => () => exitImmersive(), []);

  // B3: save the scroll position under this note's key, debounced so scrolling writes
  // at most once per 150ms pause. Saving pauses while a restore is in flight (the
  // clamped intermediate scrolls must not clobber the stored position), and cleanup
  // cancels the pending save without flushing: when a SPA navigation swaps to a shorter
  // note, the browser clamps scrollY to 0 before this listener detaches, and saving
  // that would erase the position we are about to restore.
  const restoring = useRef(false);
  useEffect(() => {
    if (visualsOpen) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onScroll = () => {
      if (restoring.current || timer !== null) return;
      timer = setTimeout(() => {
        timer = null;
        saveScrollPosition(set, path, window.scrollY);
      }, 150);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (timer !== null) clearTimeout(timer);
    };
  }, [set, path, visualsOpen]);
  const restoredNote = useRef<string | null>(null);
  useEffect(() => {
    const noteKey = `${set}/${path}/${visualsOpen ? "visuals" : "reading"}`;
    if (restoredNote.current === noteKey) return;
    restoredNote.current = noteKey;
    if (visualsOpen) {
      window.scrollTo(0, 0);
      return;
    }
    const target = readScrollPosition(set, path);
    // An in-note anchor (footnote/citation link) takes precedence over the restore.
    if (target === null || window.location.hash || new URLSearchParams(window.location.search).has("q")) return;

    const maxScroll = () => Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    restoring.current = true;
    let lastSet = window.scrollY;
    window.scrollTo(0, Math.min(target, maxScroll()));
    lastSet = window.scrollY;
    // Content keeps growing for a moment (web fonts, mermaid, images); top the scroll
    // back up as it does — for at most 2s, and never past what the reader scrolled to.
    const deadline = performance.now() + 2000;
    let frame = requestAnimationFrame(function tick() {
      if (Math.abs(window.scrollY - lastSet) >= 4) {
        restoring.current = false; // the reader scrolled somewhere else; leave them there
        return;
      }
      const clamped = Math.min(target, maxScroll());
      window.scrollTo(0, clamped);
      lastSet = clamped;
      if (clamped < target && performance.now() < deadline) {
        frame = requestAnimationFrame(tick);
        return;
      }
      restoring.current = false;
    });
    return () => {
      cancelAnimationFrame(frame);
      restoring.current = false;
    };
  }, [set, path, visualsOpen]);

  // Notes usually open with their own `# Title`; only show the frontmatter title when they don't.
  const bodyHasTitle = /^\s*#\s/.test(chapter.body);

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
    <div
      className={cn("flex min-h-full w-full items-stretch", className)}
      // B1: the reader root carries the reading prefs as `--reader-*` variables.
      // B3 owns the reading position. Browser scroll anchoring must not shift it
      // when a lazy player or a newly selected tab changes the content height.
      style={{ ...readingPrefsVars(prefs), overflowAnchor: "none" }}
    >
      <article
        className={cn(
          "min-w-0 flex-1 px-4 py-4 md:px-6 md:py-6",
          // Immersive hides the mobile header, so the article picks up the safe-area top
          // inset itself; desktop gets extra breathing room over the toolbar.
          immersive && "pt-[calc(env(safe-area-inset-top,0px)+1rem)] md:pt-16",
        )}
      >
        <Tabs.Root
          value={visualsOpen ? "visuals" : "reading"}
          onValueChange={(value) => changeView(String(value))}
          className="mx-auto w-full"
        >
          {/* Phone: the toolbar gets its own row, since floating it beside the title clips it. */}
          <div
            className={cn(
              "sticky top-12 z-20 mb-4 flex items-center justify-between gap-2 bg-background py-2 transition-transform duration-200 motion-reduce:transition-none md:top-0 md:flex-wrap md:gap-4",
              immersive && "top-0",
              // Phones: slide away while scrolling down, back on scroll up (the bar is otherwise permanent).
              toolbarHidden && "max-md:-translate-y-[calc(100%+3.5rem)]",
            )}
          >
            {/* Chapters without visuals show no tabs: an empty Visuals tab is noise (docs/UX.md). */}
            {chapter.visuals.length === 0 && !visualsOpen ? (
              <span />
            ) : (
              <Tabs.List className="flex gap-1 rounded-lg bg-muted p-1" aria-label="Chapter views">
                <Tabs.Tab
                  value="reading"
                  className="min-h-11 rounded-md px-3 text-sm font-medium md:px-4 text-muted-foreground data-[active]:bg-background data-[active]:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Reading
                </Tabs.Tab>
                <Tabs.Tab
                  value="visuals"
                  className="min-h-11 rounded-md px-3 text-sm font-medium md:px-4 text-muted-foreground data-[active]:bg-background data-[active]:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
                >
                  Visuals{chapter.visuals.length > 0 && ` (${chapter.visuals.length})`}
                </Tabs.Tab>
              </Tabs.List>
            )}
            <div className="flex shrink-0 items-center gap-2 md:flex-wrap">
              <Button
                variant="outline"
                size="sm"
                className="h-11 min-w-11 md:h-7 md:min-w-0"
                onClick={() => void makeCards()}
                disabled={makingCards}
              >
                <LayersIcon />
                <span className="max-sm:sr-only">{makingCards ? "Starting…" : "Make cards"}</span>
              </Button>
              <ReadingSettingsControl />
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label="More note actions"
                  disabled={deletion.pending}
                  className={cn(buttonVariants({ variant: "outline", size: "sm" }), "h-11 min-w-11 md:h-7 md:min-w-0")}
                >
                  {deletion.pending ? <Spinner aria-label="Checking deletion" /> : <MoreHorizontalIcon />}
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-44">
                  <DropdownMenuGroup>
                    <DropdownMenuItem className="min-h-11 md:min-h-0" onClick={() => setRewriteOpen(true)}>
                      <RefreshCwIcon />
                      Rewrite in teaching voice
                    </DropdownMenuItem>
                    <DropdownMenuItem className="min-h-11 md:min-h-0" onClick={() => setEditing(true)}>
                      <PencilIcon />
                      Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="min-h-11 md:min-h-0"
                      onClick={() => (historyOpen ? closeHistory() : setHistoryOpen(true))}
                    >
                      <HistoryIcon />
                      {historyOpen ? "Hide history" : "History"}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="min-h-11 md:min-h-0"
                      onClick={() => {
                        if (visualsOpen) changeView("reading");
                        setHighlightsOpen(true);
                      }}
                    >
                      <HighlighterIcon />
                      Highlights ({highlights.length})
                    </DropdownMenuItem>
                    <DropdownMenuItem className="min-h-11 md:min-h-0" onClick={toggleImmersive}>
                      {immersive ? <Minimize2Icon /> : <Maximize2Icon />}
                      {immersive ? "Exit full screen" : "Full screen"}
                    </DropdownMenuItem>
                    {deletion.items}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
          <Tabs.Panel
            value="reading"
            hidden={visualsOpen}
            className="mx-auto w-full"
            style={{ maxWidth: "calc(var(--reader-measure, 72ch) + 4rem)" }}
          >
            {numberEyebrow}
            {!bodyHasTitle && (
              <h1 className="mb-4 text-2xl font-semibold text-foreground">{titleFromFrontmatter(file)}</h1>
            )}
            <FirstUseHint id="select-text" enabled={chapter.body.trim() !== ""} className="mb-3">
              Select any text to ask the tutor about it or to highlight it.
            </FirstUseHint>
            {highlightsQuery.isError && (
              <p role="alert" className="mb-3 text-sm text-destructive">
                Could not load highlights.{" "}
                <Button variant="quiet" onClick={() => void highlightsQuery.refetch()}>
                  Try again
                </Button>
              </p>
            )}
            <ReaderPassages
              key={`${set}/${path}/${file.body}`}
              set={set}
              path={path}
              content={chapter.body}
              highlights={highlights}
              listOpen={highlightsOpen}
              onListClose={() => setHighlightsOpen(false)}
              query={searchParams.get("q") ?? ""}
            />
            <VisualsWhisper count={chapter.visuals.length} onOpen={() => changeView("visuals")} />
          </Tabs.Panel>
          <Tabs.Panel value="visuals" hidden={!visualsOpen}>
            {numberEyebrow}
            <h1 className="text-2xl font-semibold text-foreground">{titleFromFrontmatter(file)}</h1>
            <Suspense fallback={<Skeleton className="h-[65svh] w-full" aria-label="Opening visuals" />}>
              <ChapterVisuals
                key={`${set}/${path}/${file.body}`}
                visuals={chapter.visuals}
                onRead={() => changeView("reading")}
              />
            </Suspense>
          </Tabs.Panel>
        </Tabs.Root>
      </article>
      {deletion.dialog}
      <RewriteChapterDialog set={set} path={path} open={rewriteOpen} onOpenChange={setRewriteOpen} />
      {immersive && <ImmersiveExitButton />}
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
