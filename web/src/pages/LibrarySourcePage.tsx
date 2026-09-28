// `/library/:id` (T9a): title/meta header, the rendered `source.md` body (summary, TOC,
// credibility reason) via the shared MarkdownView, and the list of parsed files. Tapping a
// parsed file fetches its markdown via `GET /api/library/:id/parsed?file=<file>` (see
// server/src/routes/library.ts) and renders it: a full-screen sheet on phones (same pattern
// as NoteHistory's mobile sheet), an inline panel below the list on desktop.
import { ArrowLeftIcon, ChevronLeftIcon, FileTextIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useLibraryParsedFile, useLibrarySource } from "@/api/queries";
import { MarkdownView } from "@/components/Reader";
import { Button } from "@/components/ui/button";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { tierBadge } from "./library-utils";

function ParsedFileContent({ id, file }: { id: string; file: string }) {
  const { data, isLoading, isError } = useLibraryParsedFile(id, file);
  if (isLoading) return <p className="p-4 text-sm text-muted-foreground">Loading…</p>;
  if (isError || !data) return <p className="p-4 text-sm text-destructive">Failed to load this file.</p>;
  return (
    <div className="p-4">
      <MarkdownView content={data.markdown} />
    </div>
  );
}

/** Mobile: full-screen sheet over the page (same pattern as NoteHistory's mobile view). */
function ParsedFileSheet({ id, file, onClose }: { id: string; file: string; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-50 flex h-[100dvh] min-w-0 flex-col bg-background">
      <div
        className="flex items-center justify-between border-b border-border/70 px-3 py-2"
        style={{ paddingTop: "calc(env(safe-area-inset-top, 0px) + 0.5rem)" }}
      >
        <Button variant="ghost" size="sm" onClick={onClose}>
          <ChevronLeftIcon />
          Back
        </Button>
        <span className="min-w-0 flex-1 truncate text-center text-sm font-medium text-foreground">{file}</span>
        <Button variant="ghost" size="icon-sm" aria-label="Close preview" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto" style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}>
        <ParsedFileContent id={id} file={file} />
      </div>
    </div>
  );
}

/** Desktop: inline panel below the parsed-files list. */
function ParsedFilePanel({ id, file, onClose }: { id: string; file: string; onClose: () => void }) {
  return (
    <div className="mt-3 rounded-md border border-border/70">
      <div className="flex items-center justify-between border-b border-border/70 px-3 py-2">
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">{file}</span>
        <Button variant="ghost" size="icon-sm" aria-label="Close preview" onClick={onClose}>
          <XIcon />
        </Button>
      </div>
      <ParsedFileContent id={id} file={file} />
    </div>
  );
}

export default function LibrarySourcePage() {
  const { id } = useParams<{ id: string }>();
  const { data, isLoading, isError } = useLibrarySource(id);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const isDesktop = useMediaQuery("(min-width: 1024px)");

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
          <ul className="flex flex-col gap-1">
            {parsedFiles.map((path) => (
              <li key={path}>
                <button
                  type="button"
                  onClick={() => setOpenFile(path)}
                  className="flex min-h-[44px] w-full items-center gap-2 rounded-md border border-border/70 px-3 py-2 text-start text-sm text-foreground hover:bg-accent/40"
                >
                  <FileTextIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <span className="truncate">{path}</span>
                </button>
              </li>
            ))}
          </ul>
          {openFile && isDesktop && id && <ParsedFilePanel id={id} file={openFile} onClose={() => setOpenFile(null)} />}
        </div>
      )}

      {openFile && !isDesktop && id && <ParsedFileSheet id={id} file={openFile} onClose={() => setOpenFile(null)} />}
    </div>
  );
}
