import type { SourceSummary } from "@studium/shared";

/** Visual treatment for a `source.md` `credibility` value (docs/INGEST.md tiers A-D). */
export interface TierBadge {
  label: string;
  className: string;
}

const TIER_CLASSES: Record<"A" | "B" | "C" | "D", string> = {
  A: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400",
  B: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-400",
  C: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400",
  D: "bg-gray-200 text-gray-700 dark:bg-gray-500/15 dark:text-gray-400",
};

const PENDING_BADGE: TierBadge = { label: "Pending", className: "bg-muted text-muted-foreground" };

/**
 * Maps a source's `credibility` frontmatter value to a badge (label + Tailwind classes).
 * `null` or the library writer's placeholder `"pending"` (T6 `PENDING_CREDIBILITY`) render
 * as a muted "Pending" chip until the Librarian fills it in; anything starting with A-D
 * (case-insensitive — the Librarian may write "A" or a longer "A - reason" string) gets its
 * tier color; any other non-empty value falls back to a muted chip showing that text as-is.
 */
export function tierBadge(credibility: string | null | undefined): TierBadge {
  const value = credibility?.trim();
  if (!value || value.toLowerCase() === "pending") return PENDING_BADGE;
  const tier = value.charAt(0).toUpperCase();
  if (tier === "A" || tier === "B" || tier === "C" || tier === "D") {
    return { label: tier, className: TIER_CLASSES[tier] };
  }
  return { label: value, className: PENDING_BADGE.className };
}

/** Client-side search over the library list: matches title, authors, or id (case-insensitive). */
export function filterSources(sources: SourceSummary[], query: string): SourceSummary[] {
  const q = query.trim().toLowerCase();
  if (!q) return sources;
  return sources.filter((source) => {
    if (source.title.toLowerCase().includes(q)) return true;
    if (source.id.toLowerCase().includes(q)) return true;
    return source.authors.some((author) => author.toLowerCase().includes(q));
  });
}
