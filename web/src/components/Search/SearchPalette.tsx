import type { SearchKind, SearchResult } from "@studium/shared";
import { useQuery } from "@tanstack/react-query";
import { SearchIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { api } from "@/api/client";
import { queryKeys } from "@/api/queries";
import { openChatDock } from "@/components/ChatDock/openChatDock";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { searchHref } from "./helpers";
import { SearchSnippet } from "./SearchSnippet";

const OPEN_SEARCH = "studium:open-search";
const kinds = ["note", "source", "card", "chat"] as const;
const labels: Record<SearchKind, string> = { note: "Notes", source: "Sources", card: "Cards", chat: "Chats" };
const RECENTS_KEY = "studium:recent-searches";
function readRecents(): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENTS_KEY) ?? "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").slice(0, 6) : [];
  } catch {
    return [];
  }
}
export function SearchButton({ compact = false, onOpen }: { compact?: boolean; onOpen?: () => void }) {
  return (
    <Button
      variant="quiet"
      size={compact ? "icon" : "sm"}
      className={compact ? "size-11" : "min-h-11"}
      aria-label="Search"
      title="Search (Ctrl/⌘ K)"
      onClick={() => {
        onOpen?.();
        window.dispatchEvent(new Event(OPEN_SEARCH));
      }}
    >
      <SearchIcon className="size-4" />
      {!compact && (
        <span>
          Search <kbd className="ms-2 text-xs text-muted-foreground">⌘K</kbd>
        </span>
      )}
    </Button>
  );
}

export function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [debounced, setDebounced] = useState("");
  const [kind, setKind] = useState<SearchKind | undefined>();
  const [thisSet, setThisSet] = useState(false);
  const [active, setActive] = useState(0);
  const [recents, setRecents] = useState(readRecents);
  const resultsRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const location = useLocation();
  const set = /^\/s\/([^/]+)/.exec(location.pathname)?.[1];
  useEffect(() => {
    const show = () => setOpen(true);
    const keydown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "k" &&
        !target?.closest("[data-note-editor]")
      ) {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    window.addEventListener(OPEN_SEARCH, show);
    window.addEventListener("keydown", keydown);
    return () => {
      window.removeEventListener(OPEN_SEARCH, show);
      window.removeEventListener("keydown", keydown);
    };
  }, []);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(q.trim()), 200);
    return () => clearTimeout(timer);
  }, [q]);
  const query = useQuery({
    queryKey: [...queryKeys.search, debounced, kind ?? null, thisSet ? set : null],
    queryFn: () => api.search(debounced, { kind, set: thisSet ? set : undefined, limit: 40 }),
    enabled: open && debounced.length > 0,
  });
  const results = kinds.flatMap((group) => (query.data?.results ?? []).filter((result) => result.kind === group));
  const waiting = q.trim() !== debounced || query.isFetching;
  // Reset the keyboard cursor when the query or its filters change.
  useEffect(() => {
    void debounced;
    void kind;
    void thisSet;
    setActive(0);
  }, [debounced, kind, thisSet]);
  useEffect(() => {
    if (open)
      resultsRef.current?.querySelector(`[data-result-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);
  function choose(result: SearchResult) {
    const recent = [debounced, ...recents.filter((item) => item !== debounced)].filter(Boolean).slice(0, 6);
    setRecents(recent);
    try {
      localStorage.setItem(RECENTS_KEY, JSON.stringify(recent));
    } catch {
      /* Storage may be unavailable. */
    }
    setOpen(false);
    navigate(searchHref(result, debounced));
    if (result.kind === "chat" && result.set) openChatDock({ set: result.set, chatId: result.path.split("/").at(-1) });
  }
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-sm:inset-0 h-dvh max-h-dvh rounded-none pb-[calc(env(safe-area-inset-bottom,0px)+1rem)] pt-[calc(env(safe-area-inset-top,0px)+1rem)] sm:inset-x-auto sm:start-1/2 sm:h-auto sm:max-h-[80dvh] sm:max-w-2xl sm:rounded-xl sm:p-5">
        <DialogTitle>Search</DialogTitle>
        <DialogDescription className="sr-only">
          Find notes, sources, cards and chats. Use the arrow keys and Enter to open a result.
        </DialogDescription>
        <div>
          <Label htmlFor="study-search" className="sr-only">
            Search your study tree
          </Label>
          <Input
            id="study-search"
            value={q}
            maxLength={200}
            placeholder="Find a passage, source or card…"
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => {
              if (waiting || results.length === 0) return;
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length);
              }
              if (event.key === "Enter" && results[active]) {
                event.preventDefault();
                choose(results[active]);
              }
            }}
          />
        </div>
        <fieldset className="flex flex-wrap gap-2">
          <legend className="sr-only">Search filters</legend>
          <Button
            size="sm"
            className="min-h-11"
            variant={!kind ? "secondary" : "outline"}
            aria-pressed={!kind}
            onClick={() => setKind(undefined)}
          >
            All
          </Button>
          {kinds.map((value) => (
            <Button
              key={value}
              size="sm"
              className="min-h-11"
              variant={kind === value ? "secondary" : "outline"}
              aria-pressed={kind === value}
              onClick={() => setKind(value)}
            >
              {labels[value]}
            </Button>
          ))}
          {set && (
            <Button
              size="sm"
              className="min-h-11"
              variant={thisSet ? "secondary" : "outline"}
              aria-pressed={thisSet}
              onClick={() => setThisSet(!thisSet)}
            >
              This set
            </Button>
          )}
        </fieldset>
        <div ref={resultsRef} className="min-h-0 flex-1 overflow-y-auto sm:max-h-[50dvh]" aria-busy={waiting}>
          {!q.trim() ? (
            <div className="flex flex-col gap-2 py-2">
              <p className="text-sm font-medium">Recent searches</p>
              {recents.length ? (
                recents.map((recent) => (
                  <Button key={recent} variant="quiet" className="min-h-11 justify-start" onClick={() => setQ(recent)}>
                    {recent}
                  </Button>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">Your searches will appear here.</p>
              )}
              <p className="mt-3 text-sm text-muted-foreground">
                Try a concept or a source title. Filter by kind to narrow it down.
              </p>
            </div>
          ) : waiting ? (
            <p role="status" className="py-4 text-sm text-muted-foreground">
              Searching…
            </p>
          ) : query.isError ? (
            <p role="alert" className="py-4 text-sm text-destructive">
              Search failed.{" "}
              <Button variant="quiet" onClick={() => void query.refetch()}>
                Try again
              </Button>
            </p>
          ) : results.length === 0 ? (
            <p role="status" className="py-4 text-sm text-muted-foreground">
              No results. Try fewer words or another filter.
            </p>
          ) : (
            kinds.map((group) => {
              const grouped = results.filter((result) => result.kind === group);
              return (
                grouped.length > 0 && (
                  <section key={group} className="mb-4">
                    <h2 className="mb-1 text-xs font-semibold text-muted-foreground">{labels[group]}</h2>
                    {grouped.map((result) => {
                      const index = results.indexOf(result);
                      return (
                        <button
                          key={`${result.kind}-${result.path}`}
                          type="button"
                          data-result-index={index}
                          aria-current={index === active ? "true" : undefined}
                          className={cn(
                            "flex min-h-16 w-full flex-col gap-1 rounded-lg p-3 text-start transition-colors hover:bg-accent/50 focus-visible:outline-2 focus-visible:outline-ring",
                            index === active && "bg-accent",
                          )}
                          onClick={() => choose(result)}
                        >
                          <span className="text-sm font-medium text-foreground">{result.title}</span>
                          <span className="line-clamp-2 text-sm text-muted-foreground">
                            <SearchSnippet snippet={result.snippet} />
                          </span>
                        </button>
                      );
                    })}
                  </section>
                )
              );
            })
          )}
        </div>
        <p className="hidden text-xs text-muted-foreground sm:block">↑ ↓ to choose · Enter to open · Esc to close</p>
      </DialogContent>
    </Dialog>
  );
}
