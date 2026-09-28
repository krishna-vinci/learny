// `/library` (T9a): search box over the client-cached list, one row per source with its
// type icon, credibility tier badge, parse tier, warning tooltip, and linked sets. Mobile-
// first (390px, 44px rows); desktop caps at max-w-4xl like the reader.
import type { SourceSummary, SourceType } from "@studium/shared";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangleIcon,
  BookOpenIcon,
  FileTextIcon,
  NewspaperIcon,
  NotebookTextIcon,
  PlusIcon,
  SearchIcon,
  VideoIcon,
} from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";
import { useLibrary } from "@/api/queries";
import { AddSourceSheet } from "@/components/Library/AddSourceSheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { filterSources, tierBadge } from "./library-utils";
import { useLastVisitedSet } from "./useLastVisitedSet";

const TYPE_ICON: Record<SourceType, LucideIcon> = {
  book: BookOpenIcon,
  paper: FileTextIcon,
  article: NewspaperIcon,
  video: VideoIcon,
  notes: NotebookTextIcon,
  other: FileTextIcon,
};

export default function LibraryPage() {
  const { data: sources = [], isLoading } = useLibrary();
  const [query, setQuery] = useState("");
  const [sheetOpen, setSheetOpen] = useState(false);
  const defaultSet = useLastVisitedSet();
  const filtered = filterSources(sources, query);

  return (
    <TooltipProvider>
      <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-lg font-semibold">Library</h1>
          <Button onClick={() => setSheetOpen(true)}>
            <PlusIcon /> Add source
          </Button>
        </div>

        {sources.length > 0 && (
          <div className="relative">
            <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search title, author, or id…"
              className="h-11 ps-9"
            />
          </div>
        )}

        {isLoading && <p className="text-sm text-muted-foreground">Loading…</p>}

        {!isLoading && sources.length === 0 && (
          <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-border px-6 py-16 text-center">
            <BookOpenIcon className="size-10 text-muted-foreground/60" />
            <p className="text-sm font-medium">No sources yet</p>
            <p className="max-w-xs text-sm text-muted-foreground">
              Add a web page, PDF, Wikipedia article, or paper to start building your library.
            </p>
            <Button onClick={() => setSheetOpen(true)}>
              <PlusIcon /> Add source
            </Button>
          </div>
        )}

        {!isLoading && sources.length > 0 && filtered.length === 0 && (
          <p className="text-sm text-muted-foreground">No sources match "{query}".</p>
        )}

        {filtered.length > 0 && (
          <ul className="flex flex-col gap-2">
            {filtered.map((source) => (
              <SourceRow key={source.id} source={source} />
            ))}
          </ul>
        )}
      </div>

      <AddSourceSheet open={sheetOpen} onOpenChange={setSheetOpen} defaultSet={defaultSet} />
    </TooltipProvider>
  );
}

function SourceRow({ source }: { source: SourceSummary }) {
  const Icon = TYPE_ICON[source.type] ?? FileTextIcon;
  const badge = tierBadge(source.credibility);

  return (
    <li>
      <Link
        to={`/library/${encodeURIComponent(source.id)}`}
        className="flex min-h-[44px] items-center gap-3 rounded-lg border border-border/70 px-3 py-2.5 hover:bg-accent/50"
      >
        <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <p className="truncate text-sm font-medium">{source.title}</p>
            {source.warning && (
              <Tooltip>
                <TooltipTrigger className="shrink-0" aria-label={source.warning}>
                  <AlertTriangleIcon className="size-3.5 text-amber-500" />
                </TooltipTrigger>
                <TooltipContent side="top">{source.warning}</TooltipContent>
              </Tooltip>
            )}
          </div>
          <p className="truncate text-xs text-muted-foreground">
            {source.authors.length > 0 ? source.authors.join(", ") : "Unknown author"} · {source.parseTier}
            {source.sets.length > 0 ? ` · ${source.sets.join(", ")}` : ""}
          </p>
        </div>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium", badge.className)}>
          {badge.label}
        </span>
      </Link>
    </li>
  );
}
