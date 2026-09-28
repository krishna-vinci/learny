import { useEffect } from "react";
import { useOpenNote } from "@/components/ChatDock/useOpenNote";

const STORAGE_KEY = "studium.lastSet";

/**
 * The study set to default "Add to current set" to on `/library` pages, which aren't
 * nested under `/s/:set`. Prefers the current route's set (via the same URL parser
 * ChatDock uses for its own set-less placement in RootLayout); remembers the last one
 * seen in localStorage so it still has an answer once the user navigates away to Library.
 */
export function useLastVisitedSet(): string | null {
  const { set } = useOpenNote();

  useEffect(() => {
    if (!set) return;
    try {
      localStorage.setItem(STORAGE_KEY, set);
    } catch {
      // Private browsing / storage disabled: fall back to route-only below.
    }
  }, [set]);

  if (set) return set;
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
