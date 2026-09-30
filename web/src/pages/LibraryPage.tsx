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
import { RowsSkeleton } from "@/components/ListSkeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { filterSources, parseTierLabel, tierBadge } from "./library-utils";
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
          <h1 className="text-lg font-semibold">Sources</h1>
          <Button className="h-11 md:h-9" onClick={() => setSheetOpen(true)}>
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

        {isLoading && <RowsSkeleton rows={4} />}

        {!isLoading && sources.length === 0 && (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <BookOpenIcon />
              </EmptyMedia>
              <EmptyTitle>No sources yet</EmptyTitle>
              <EmptyDescription>
                Add a web page, PDF, Wikipedia article, or paper to start building your library.
              </EmptyDescription>
            </EmptyHeader>
            <EmptyContent>
              <Button className="h-11 md:h-9" onClick={() => setSheetOpen(true)}>
                <PlusIcon /> Add source
              </Button>
            </EmptyContent>
          </Empty>
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
            {source.authors.length > 0 ? source.authors.join(", ") : "Unknown author"} ·{" "}
            {parseTierLabel(source.parseTier)}
            {source.sets.length > 0 ? ` · ${source.sets.join(", ")}` : ""}
          </p>
        </div>
        <Badge variant={badge.variant} title={`Source quality: ${badge.label}`}>
          {badge.label}
        </Badge>
      </Link>
    </li>
  );
}
