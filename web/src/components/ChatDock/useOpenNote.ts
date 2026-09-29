import { useLocation } from "react-router-dom";

export interface OpenNote {
  /** The active study set slug, or null when the URL isn't under /s/:set. */
  set: string | null;
  /** The open note's set-relative path (e.g. "notes/03-svd.md"), or null when none is open. */
  anchor: string | null;
  /** `anchor` with the "notes/" prefix stripped, i.e. the segment used in `/s/:set/n/<rest>`. */
  anchorRest: string | null;
}

// `set` matches any route nested under `/s/:set` (home, inbox, cards, cards/*, n/*) so
// consumers like the sidebar's set fallback and ChatDock's set-scoping work no matter
// which set-scoped page the person is on, not just the set home and note reader; `anchor`
// stays narrow — only the note reader actually has a note open to attach chat messages to.
const SET_PATTERN = /^\/s\/([^/]+)(?:\/.*)?$/;
const NOTE_PATTERN = /^\/s\/[^/]+\/n\/(.*)$/;

/**
 * ChatDock lives in RootLayout, outside the `/s/:set` and `/s/:set/n/*` route elements'
 * own context, so it can't read their params via useParams(). Location is global
 * regardless of nesting, so parse the same shape out of the pathname instead (see
 * router.tsx for the matching route definitions).
 */
export function parseOpenNote(pathname: string): OpenNote {
  const setMatch = SET_PATTERN.exec(pathname);
  const set = setMatch ? decodeURIComponent(setMatch[1] ?? "") : null;

  const noteMatch = NOTE_PATTERN.exec(pathname);
  if (!noteMatch) return { set, anchor: null, anchorRest: null };
  const rest = noteMatch[1] ?? "";
  return { set, anchor: `notes/${rest}`, anchorRest: rest };
}

export function useOpenNote(): OpenNote {
  const location = useLocation();
  return parseOpenNote(location.pathname);
}
