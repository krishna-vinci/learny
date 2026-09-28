import type { FileView } from "@studium/shared";
import { HistoryIcon } from "lucide-react";
import { useState } from "react";
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

/** The note reader: title + rendered body, with a history panel toggled from the note header
 * (`GET /history`, `GET /diff`, `POST /revert` — see `NoteHistory`). */
export function Reader({ set, path, file, className }: ReaderProps) {
  const [historyOpen, setHistoryOpen] = useState(false);

  return (
    <div className={cn("flex min-h-full w-full items-stretch", className)}>
      <article className="min-w-0 flex-1 px-6 py-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <h1 className="text-2xl font-semibold text-foreground">{titleFromFrontmatter(file)}</h1>
          <Button
            variant={historyOpen ? "secondary" : "outline"}
            size="sm"
            aria-pressed={historyOpen}
            onClick={() => setHistoryOpen((open) => !open)}
          >
            <HistoryIcon />
            History
          </Button>
        </div>
        <MarkdownView content={file.body} />
      </article>
      {historyOpen && (
        <NoteHistory
          set={set}
          path={path}
          className="w-80 shrink-0 border-s border-border/70"
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  );
}
