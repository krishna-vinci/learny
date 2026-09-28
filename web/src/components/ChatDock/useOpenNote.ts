import { useLocation } from "react-router-dom";

export interface OpenNote {
  /** The active study set slug, or null when the URL isn't under /s/:set. */
  set: string | null;
  /** The open note's set-relative path (e.g. "notes/03-svd.md"), or null when none is open. */
  anchor: string | null;
  /** `anchor` with the "notes/" prefix stripped, i.e. the segment used in `/s/:set/n/<rest>`. */
  anchorRest: string | null;
}

const ROUTE_PATTERN = /^\/s\/([^/]+)(?:\/n\/(.*))?$/;

/**
 * ChatDock lives in RootLayout, outside the `/s/:set` and `/s/:set/n/*` route elements'
 * own context, so it can't read their params via useParams(). Location is global
 * regardless of nesting, so parse the same shape out of the pathname instead (see
 * router.tsx for the matching route definitions).
 */
export function parseOpenNote(pathname: string): OpenNote {
  const match = ROUTE_PATTERN.exec(pathname);
  if (!match) return { set: null, anchor: null, anchorRest: null };
  const set = decodeURIComponent(match[1] ?? "");
  const rest = match[2];
  if (rest === undefined) return { set, anchor: null, anchorRest: null };
  return { set, anchor: `notes/${rest}`, anchorRest: rest };
}

export function useOpenNote(): OpenNote {
  const location = useLocation();
  return parseOpenNote(location.pathname);
}
