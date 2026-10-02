import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** Why a visual cannot be shown; each kind gets its own copy and its own affordance. */
export type VisualFailure =
  | { kind: "connection" }
  | { kind: "content"; detail: string }
  | { kind: "runtime"; detail: string };

export function visualFailureDetail(error: unknown): string {
  return String((error as Error | undefined)?.message ?? error)
    .trim()
    .slice(0, 300);
}

/**
 * Full screen without reparenting: toggling only switches classes on the same element tree, so a
 * running iframe keeps its document and never reloads. Escape, the exit button, body scroll
 * locking and focus restore are handled here; the caller attaches `exitButton` to its exit
 * control. No ancestor of the reader uses transform/filter/backdrop-filter, so `position: fixed`
 * is not trapped by a containing block.
 */
export function useVisualFullscreen() {
  const [full, setFull] = useState(false);
  const exitButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);
  const toggle = useCallback(() => setFull((value) => !value), []);
  useEffect(() => {
    if (!full) return;
    restoreFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    exitButton.current?.focus();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFull(false);
    };
    window.addEventListener("keydown", onEscape);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener("keydown", onEscape);
      restoreFocus.current?.focus();
    };
  }, [full]);
  return { full, toggle, exitButton };
}

export const FULLSCREEN_SECTION = "fixed inset-0 z-50 flex flex-col bg-background p-4";

/** The uniform parent-side control row under every staged visual; each kind composes its own
 * buttons into the same strip so controls never move between visuals. */
export function VisualStrip({ children }: { children: ReactNode }) {
  return <div className="mt-2 flex flex-wrap items-center gap-2">{children}</div>;
}

export function VisualFailureCard({
  failure,
  onRetry,
  onRestart,
}: {
  failure: VisualFailure;
  onRetry?: () => void;
  onRestart?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex h-[65svh] min-h-80 flex-col items-center justify-center gap-4 rounded-lg border border-border/70 p-4 text-center"
    >
      <p className="text-sm text-muted-foreground">
        {failure.kind === "connection"
          ? "This visual needs a connection."
          : failure.kind === "content"
            ? "This visual has a problem and can't be shown."
            : "This visual stopped with an error."}
      </p>
      {failure.kind !== "connection" && failure.detail !== "" && (
        <details className="max-w-full text-xs text-muted-foreground">
          <summary className="cursor-pointer">Details</summary>
          <p className="mt-1 max-w-96 break-words text-left">{failure.detail}</p>
        </details>
      )}
      {failure.kind === "connection" && onRetry !== undefined && (
        <Button variant="outline" className="min-h-11" onClick={onRetry}>
          Try again
        </Button>
      )}
      {failure.kind === "runtime" && onRestart !== undefined && (
        <Button variant="outline" className="min-h-11" onClick={onRestart}>
          Restart
        </Button>
      )}
    </div>
  );
}
