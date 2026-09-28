// Studium-specific reader callouts for note directives (`:::definition`, `:::theorem`,
// `:::example`, `:::deeper`). Not derived from Memos, which has no equivalent syntax.
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const CALLOUT_LABELS: Record<string, string> = {
  definition: "Definition",
  theorem: "Theorem",
  example: "Example",
};

export function Callout({ name, children }: { name: string; children?: ReactNode }) {
  const label = CALLOUT_LABELS[name] ?? name;
  return (
    <div
      data-callout={name}
      className={cn(
        "my-3 rounded-lg border border-border bg-muted/20 px-4 py-3",
        "[&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
      )}
    >
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

/** Renders a `:::deeper` directive as a collapsed `<details>` titled "Deeper". */
export function Deeper({ children }: { children?: ReactNode }) {
  return (
    <details className="my-3 rounded-lg border border-border bg-muted/10 px-4 py-2 [&>*:last-child]:mb-0 [&_summary]:cursor-pointer">
      <summary className="text-sm font-medium text-foreground">Deeper</summary>
      <div className="mt-2 [&>*:first-child]:mt-0 [&>*:last-child]:mb-0">{children}</div>
    </details>
  );
}
