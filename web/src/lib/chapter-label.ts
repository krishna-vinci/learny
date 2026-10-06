import type { NoteSummary } from "@studium/shared";

/** `1. Title` for planned chapters; plain titles for notes outside the plan. */
export function chapterLabel(note: Pick<NoteSummary, "number" | "title">): string {
  return note.number != null ? `${note.number}. ${note.title}` : note.title;
}
