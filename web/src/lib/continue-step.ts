// The single "next best step" for a study set, shown as the primary action on the set's
// Continue page (docs/UX.md: one primary action per screen). It prefers Today's do-next item for
// the set and falls back to a sensible step from what the set contains. Copy follows the glossary.
import type { TodayItem } from "@studium/shared";

export interface StepContext {
  set: string;
  /** Today's do-next items (all sets); the first one for this set wins. */
  doNext: TodayItem[];
  notesCount: number;
  /** Library sources linked to this set. */
  linkedSources: number;
}

export type ContinueStep =
  | { kind: "link"; title: string; detail: string; cta: string; href: string }
  | { kind: "new-chapter"; title: string; detail: string; cta: string; chapterTitle?: string }
  | { kind: "add-source"; title: string; detail: string; cta: string }
  | { kind: "tutor"; title: string; detail: string; cta: string };

/** Server detail text is written for a list ("3 chapter(s) awaiting review"); make it read naturally. */
export function friendlyDetail(text: string): string {
  return text
    .replace(/\b1 chapter\(s\)/g, "1 chapter")
    .replace(/chapter\(s\)/g, "chapters")
    .replace(/\b1 draft card\(s\)/g, "1 new card")
    .replace(/draft card\(s\)/g, "new cards")
    .replace(/stale card file\(s\)/g, "cards to refresh")
    .replace(/\b1 day\(s\)/g, "1 day")
    .replace(/day\(s\)/g, "days")
    .replace(/\bawaiting review\b/g, "waiting for you");
}

const LINK_STEPS: Partial<Record<TodayItem["kind"], { title: string; cta: string }>> = {
  inbox: { title: "Review what the assistant wrote", cta: "Review" },
  "draft-cards": { title: "Check your new flashcards", cta: "Check cards" },
  "stale-cards": { title: "Refresh out-of-date flashcards", cta: "Refresh cards" },
  overdue: { title: "You're past your deadline", cta: "Open" },
};

export function nextStep({ set, doNext, notesCount, linkedSources }: StepContext): ContinueStep {
  const item = doNext.find((candidate) => candidate.set === set);
  if (item) {
    if (item.kind === "next-chapter") {
      const chapterTitle = item.title.replace(/^Draft\s+/i, "").trim();
      return {
        kind: "new-chapter",
        title: `Write "${chapterTitle}"`,
        detail: "The next chapter in your plan. The assistant drafts it from your sources.",
        cta: "Write chapter",
        chapterTitle,
      };
    }
    const known = LINK_STEPS[item.kind];
    if (known) {
      // List-style details lead with the set title ("Alg · 2 chapters…"); on the set's own page that is noise.
      const detail =
        item.kind === "overdue" ? item.detail : item.detail.split(" · ").slice(1).join(" · ") || item.detail;
      return {
        kind: "link",
        title: known.title,
        detail: friendlyDetail(detail),
        cta: known.cta,
        href: item.href,
      };
    }
  }
  if (notesCount === 0 && linkedSources === 0) {
    return {
      kind: "add-source",
      title: "Add your first source",
      detail: "A web page, PDF or paper to learn from. Your chapters are written from it.",
      cta: "Add a source",
    };
  }
  if (notesCount === 0) {
    return {
      kind: "new-chapter",
      title: "Write your first chapter",
      detail: "The assistant drafts it from your sources and checks it.",
      cta: "Write chapter",
    };
  }
  return {
    kind: "tutor",
    title: "Keep going",
    detail: "Open a chapter below, or ask the tutor about something you're unsure of.",
    cta: "Ask the tutor",
  };
}
