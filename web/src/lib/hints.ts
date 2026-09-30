// First-use hints (docs/UX.md rule 6): at most ONE hint on screen at a time, shown only the first time
// its feature appears, dismissible, never shown again. Dismissals are kept per browser in localStorage
// (server-side user settings were left out: not cheap without a new API).
import { useEffect, useState, useSyncExternalStore } from "react";

const STORAGE_KEY = "studium.hints-dismissed";

function readDismissed(): Set<string> {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    return new Set(Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : []);
  } catch {
    return new Set();
  }
}

let dismissed = readDismissed();
let active: string | null = null;
const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Try to make `id` the one visible hint. False if it was dismissed before or another hint is showing. */
export function claimHint(id: string): boolean {
  if (dismissed.has(id)) return false;
  if (active !== null && active !== id) return false;
  if (active !== id) {
    active = id;
    emit();
  }
  return true;
}

export function releaseHint(id: string): void {
  if (active === id) {
    active = null;
    emit();
  }
}

export function dismissHint(id: string): void {
  dismissed = new Set(dismissed).add(id);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...dismissed]));
  } catch {
    // Private mode: the hint stays dismissed for this session only.
  }
  releaseHint(id);
  emit();
}

/** Test helper: forget every dismissal and the active hint. */
export function resetHints(): void {
  dismissed = new Set();
  active = null;
  emit();
}

/** `show` is true while this hint is the one being displayed; `dismiss` hides it for good. */
export function useFirstUseHint(id: string, enabled = true): { show: boolean; dismiss: () => void } {
  const current = useSyncExternalStore(subscribe, () => active);
  const [, rerender] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    claimHint(id);
    return () => releaseHint(id);
  }, [id, enabled]);
  useEffect(() => {
    const unsubscribe = subscribe(() => rerender((count) => count + 1));
    return () => {
      unsubscribe();
    };
  }, []);
  return {
    show: enabled && current === id && !dismissed.has(id),
    dismiss: () => dismissHint(id),
  };
}
