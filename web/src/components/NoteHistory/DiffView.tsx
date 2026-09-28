import { cn } from "@/lib/utils";

export interface DiffViewProps {
  diff: string;
  className?: string;
}

function lineClass(line: string): string {
  if (line.startsWith("+++") || line.startsWith("---")) return "text-muted-foreground";
  if (line.startsWith("@@")) return "text-sky-600 dark:text-sky-400";
  if (line.startsWith("+")) return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400";
  if (line.startsWith("-")) return "bg-red-500/10 text-red-700 dark:text-red-400";
  return "text-foreground";
}

/** Small colored unified-diff renderer (no diff2html dependency). */
export function DiffView({ diff, className }: DiffViewProps) {
  const lines = diff.split("\n");
  return (
    <pre className={cn("overflow-x-auto rounded-md border border-border bg-muted/10 p-2 text-xs leading-5", className)}>
      {lines.map((line, index) => (
        // Diff lines have no stable identity beyond position; the whole diff is replaced
        // whenever the selected commit changes (see NoteHistory), so index keys are safe here.
        // biome-ignore lint/suspicious/noArrayIndexKey: diff lines have no stable identity.
        <div key={index} className={cn("whitespace-pre-wrap break-words", lineClass(line))}>
          {line.length > 0 ? line : " "}
        </div>
      ))}
    </pre>
  );
}
