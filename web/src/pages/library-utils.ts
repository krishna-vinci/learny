import type { SourceSummary } from "@studium/shared";
import type { BadgeVariant } from "@/components/ui/badge";

/** Visual treatment for a `source.md` `credibility` value (docs/INGEST.md tiers A-D). */
export interface TierBadge {
  label: string;
  variant: BadgeVariant;
}

const TIER_VARIANTS: Record<"A" | "B" | "C" | "D", BadgeVariant> = {
  A: "success",
  B: "tint",
  C: "warning",
  D: "muted",
};

const PENDING_BADGE: TierBadge = { label: "Pending", variant: "muted" };

/**
 * Maps a source's `credibility` frontmatter value to a badge (label + Badge variant).
 * `null` or the library writer's placeholder `"pending"` (T6 `PENDING_CREDIBILITY`) render
 * as a muted "Pending" chip until the Librarian fills it in; anything starting with A-D
 * (case-insensitive — the Librarian may write "A" or a longer "A - reason" string) gets its
 * tier variant; any other non-empty value falls back to a muted chip showing that text as-is.
 */
export function tierBadge(credibility: string | null | undefined): TierBadge {
  const value = credibility?.trim();
  if (!value || value.toLowerCase() === "pending") return PENDING_BADGE;
  const tier = value.charAt(0).toUpperCase();
  if (tier === "A" || tier === "B" || tier === "C" || tier === "D") {
    return { label: tier, variant: TIER_VARIANTS[tier] };
  }
  return { label: value, variant: PENDING_BADGE.variant };
}

const PARSE_TIER_LABELS: Record<SourceSummary["parseTier"], string> = {
  basic: "Plain text",
  mineru: "Full layout",
  firecrawl: "Web capture",
  transcript: "Transcript",
};

/** How a source was read, in plain words (the `parse_tier` frontmatter value). */
export function parseTierLabel(tier: SourceSummary["parseTier"]): string {
  return PARSE_TIER_LABELS[tier] ?? tier;
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
