// `/library/:id` (T9a): title/meta header, the rendered `source.md` body (summary, TOC,
// credibility reason) via the shared MarkdownView, and the list of parsed files. There is
// no `GET` endpoint to fetch one parsed file's contents (only `GET /api/library/:id`,
// which returns `parsedFiles: string[]` — see server/src/routes/library.ts and
// server/src/ingest/library.ts's `SourceView`), so tapping a file is not wired up; see the
// note below the list and this task's final report.
import { ArrowLeftIcon, FileTextIcon } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { useLibrarySource } from "@/api/queries";
import { MarkdownView } from "@/components/Reader";
import { cn } from "@/lib/utils";
import { tierBadge } from "./library-utils";

export default function LibrarySourcePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useLibrarySource(id);

  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (isError || !data) {
    return <div className="p-6 text-sm text-destructive">Failed to load this source.</div>;
  }

  const { source, body, parsedFiles } = data;
  const badge = tierBadge(source.credibility);

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-4 p-4 sm:p-6">
      <Link
        to="/library"
        className="inline-flex min-h-[44px] items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeftIcon className="size-3.5" /> Library
      </Link>

      <div className="flex flex-col gap-2 border-b border-border/70 pb-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-lg font-semibold">{source.title}</h1>
          <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-2xs font-medium", badge.className)}>
            {badge.label}
          </span>
        </div>
        <p className="text-sm text-muted-foreground">
          {source.authors.length > 0 ? source.authors.join(", ") : "Unknown author"} · {source.type} ·{" "}
          {source.parseTier}
          {source.url && (
            <>
              {" · "}
              <a
                href={source.url}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-4"
              >
                original
              </a>
            </>
          )}
        </p>
        {source.sets.length > 0 && <p className="text-xs text-muted-foreground">In sets: {source.sets.join(", ")}</p>}
        {source.warning && <p className="text-xs text-amber-600 dark:text-amber-400">{source.warning}</p>}
      </div>

      <MarkdownView content={body} />

      {parsedFiles.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border/70 pt-4">
          <h2 className="text-sm font-semibold">Parsed files</h2>
          <p className="text-xs text-muted-foreground">
            Previewing a file's text isn't available yet — there's no API to read one.
          </p>
          <ul className="flex flex-col gap-1">
            {parsedFiles.map((path) => (
              <li
                key={path}
                className="flex min-h-[44px] items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-sm text-muted-foreground"
              >
                <FileTextIcon className="size-4 shrink-0" aria-hidden="true" />
                <span className="truncate">{path}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
