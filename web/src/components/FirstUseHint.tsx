// A single, dismissible "first time" tip. No tour, no modal. See lib/hints.ts for the rules.
import { LightbulbIcon } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useFirstUseHint } from "@/lib/hints";
import { cn } from "@/lib/utils";

export function FirstUseHint({
  id,
  enabled = true,
  className,
  children,
}: {
  id: string;
  enabled?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const { show, dismiss } = useFirstUseHint(id, enabled);
  if (!show) return null;
  return (
    <div
      role="note"
      className={cn(
        "flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-sm text-foreground",
        className,
      )}
    >
      <LightbulbIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="min-w-0 flex-1">{children}</p>
      <Button variant="quiet" size="sm" className="-my-1 h-11 shrink-0 md:h-8" onClick={dismiss}>
        Got it
      </Button>
    </div>
  );
}
