import { CARD_ID_PATTERN, type CardView } from "@studium/shared";

/** Return the user-facing reason a card cannot leave Studium, or null when valid. */
export function cardExportError(card: CardView): string | null {
  if (!CARD_ID_PATTERN.test(card.id)) {
    return `Card id ${card.id} must match c- followed by 8 lowercase hex characters`;
  }
  if (card.type === "basic") {
    if (card.q === undefined || card.a === undefined) return `Basic card ${card.id} requires Q and A fields`;
    return null;
  }
  if (card.text === undefined) return `Cloze card ${card.id} requires a Text field`;
  if (!/{{c\d+::/i.test(card.text)) return `Cloze card ${card.id} requires at least one {{cN::}} deletion`;
  return null;
}
