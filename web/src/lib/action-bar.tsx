// A sticky bottom action bar (Approve, Accept, …) that must never sit under the phone tab bar or
// the floating chat button. Bars register here so the chat button can hide while one is on
// screen (docs/UX.md: no bar overlaps; one primary action per screen).
import { type ReactNode, useEffect, useSyncExternalStore } from "react";
import { cn } from "@/lib/utils";

let count = 0;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** True while at least one `ActionBar` is mounted. */
export function useHasActionBar(): boolean {
  return useSyncExternalStore(subscribe, () => count > 0);
}

/** Sticks above the phone tab bar (3.5 rem + border + safe area) and to the bottom edge from `md:`. */
export function ActionBar({ className, children }: { className?: string; children: ReactNode }) {
  useEffect(() => {
    count += 1;
    emit();
    return () => {
      count -= 1;
      emit();
    };
  }, []);
  return (
    <div
      data-action-bar
      className={cn(
        "sticky bottom-[calc(3.6rem+env(safe-area-inset-bottom,0px))] z-10 border-t border-border/70 bg-background py-3 md:bottom-0",
        className,
      )}
    >
      {children}
    </div>
  );
}
