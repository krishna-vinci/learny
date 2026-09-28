import { useEffect, useState } from "react";

/** Tracks a CSS media query (e.g. `"(min-width: 1024px)"`), re-evaluating on viewport
 * changes. Used to pick which of two shells to mount (rather than hiding one with CSS)
 * when only one of them should actually be alive at a time — see ChatDock. */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);

  useEffect(() => {
    const mql = window.matchMedia(query);
    setMatches(mql.matches);
    const listener = (event: MediaQueryListEvent) => setMatches(event.matches);
    mql.addEventListener("change", listener);
    return () => mql.removeEventListener("change", listener);
  }, [query]);

  return matches;
}
