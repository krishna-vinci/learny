// Pure helpers for the Cards pages (list, file view, review mode). Kept free of React so
// they're cheap to unit test — see cards-utils.test.ts.
import type { CardCritic, CardStatus, CardView } from "@studium/shared";

const CLOZE_PATTERN = /\{\{c\d+::([^}]*?)(?:::([^}]*?))?\}\}/g;

/**
 * Renders a cloze card's `Text` field for review: before reveal, each `{{cN::content}}` (or
 * `{{cN::content::hint}}`) collapses to a blank (its hint, or `[...]`); after reveal, the
 * cloze content itself is shown, bolded so it stands out from the surrounding text. The
 * result is still Markdown, meant to be fed straight into `MarkdownView`.
 */
export function renderClozeText(text: string, revealed: boolean): string {
  return text.replace(CLOZE_PATTERN, (_match, content: string, hint: string | undefined) => {
    if (revealed) return `**${content}**`;
    return hint && hint.trim() !== "" ? `[${hint}]` : "[...]";
  });
}

/** Fixed display order for the review filter tabs and the file-list status chips. */
export const CARD_STATUS_ORDER: readonly CardStatus[] = ["draft", "approved", "rejected", "exported"];

export interface StatusChip {
  status: CardStatus;
  count: number;
}

/** Non-zero status counts, in `CARD_STATUS_ORDER`, for the small chips on a card file row. */
export function statusChips(counts: Record<CardStatus, number>): StatusChip[] {
  return CARD_STATUS_ORDER.filter((status) => (counts[status] ?? 0) > 0).map((status) => ({
    status,
    count: counts[status],
  }));
}

/** Review-mode filter tabs: the four statuses, plus "All". */
export type ReviewFilter = CardStatus | "all";
export const REVIEW_FILTERS: readonly ReviewFilter[] = ["draft", "approved", "rejected", "exported", "all"];

/** Cards to show for a given filter tab, in file order. */
export function filterCardsByStatus(cards: readonly CardView[], filter: ReviewFilter): CardView[] {
  if (filter === "all") return [...cards];
  return cards.filter((card) => card.status === filter);
}

/**
 * The index to move to from `current` (out of `count` cards) when navigating with `j`/`k`,
 * arrow keys, or the phone nav buttons. Wraps around at both ends; returns 0 for an empty
 * list so callers never index out of range.
 */
export function nextCardIndex(count: number, current: number, direction: 1 | -1): number {
  if (count <= 0) return 0;
  return (current + direction + count) % count;
}

/** `"ok"` or `"Rule N: reason"` / `"Rule N"` / `"Rejected"`, for the critic-verdict line. */
export function criticLabel(critic: CardCritic | undefined): string | null {
  if (!critic) return null;
  if (critic.verdict === "ok") return "ok";
  const rule = critic.rule !== undefined ? `Rule ${critic.rule}` : "Rejected";
  return critic.reason ? `${rule}: ${critic.reason}` : rule;
}
