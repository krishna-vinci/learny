import type { CardCritic, CardStatus, CardType, CardView } from "./api.js";
import { parseFrontmatter } from "./frontmatter.js";

/**
 * Card file format (`<set>/cards/NN-slug.md`, docs/STUDY_TREE.md):
 *
 * ```md
 * ---
 * deck: Linear Algebra::SVD
 * note: notes/03-svd.md
 * note_sha: <commit sha the cards were last made or reviewed against>
 * ---
 *
 * ## c-8f3a1b2c
 * <!-- <key>: <value> separated by the middot used in docs/STUDY_TREE.md -->
 * **Q:** ...
 * **A:** ...
 * ```
 *
 * Known comment keys: `status`, `type`, `anki`, `src`, `critic`. Keys are
 * optional except `status` and `type`.
 *
 * Parsing never drops text: unrecognised sections and malformed card sections are
 * returned as verbatim blocks so `serializeCardFile` can reproduce the input
 * byte-for-byte. Comment keys keep their file order; unknown keys survive an edit.
 */

export const CARD_ID_PATTERN = /^c-[0-9a-f]{4,}$/;

export const CARD_STATUSES: readonly CardStatus[] = ["draft", "approved", "rejected", "exported"];
export const CARD_TYPES: readonly CardType[] = ["basic", "cloze"];

/** The separator docs/STUDY_TREE.md uses inside a card comment line. */
const SEPARATOR = "\u00b7";

const HEADING = /^##[ \t]+(\S+)[ \t]*\r?$/gm;
const COMMENT_LINE = /^(?:[ \t]*\r?\n)*([ \t]*<!--[^\n]*-->)[ \t]*\r?\n?/;
const BODY_FIELD = /^\*\*(Q|A|Text|Extra):\*\*[ \t]?(.*)$/;

export type CardBodyField = "q" | "a" | "text" | "extra";

const BODY_LABELS: Record<CardBodyField, string> = { q: "Q", a: "A", text: "Text", extra: "Extra" };

export interface CardCommentField {
  key: string;
  value: string;
}

export interface MalformedCardSection {
  heading: string;
  reason: string;
  raw: string;
}

export interface ParsedCard {
  id: string;
  /** Exact heading line, e.g. `## c-8f3a1b2c`. */
  head: string;
  /** Exact comment line without its trailing newline, or "" when absent. */
  comment: string;
  /** Exact text after the comment line (or heading line when there is none). */
  body: string;
  /** Full exact section text, used for in-place edits. */
  raw: string;
  /** Comment keys in file order; unknown keys are preserved. */
  fields: CardCommentField[];
  type: CardType | null;
  status: CardStatus | null;
  q: string | null;
  a: string | null;
  text: string | null;
  extra: string | null;
  src: string | null;
  ankiId: number | null;
  critic: CardCritic | null;
}

export type CardFileBlock = { kind: "card"; card: ParsedCard } | { kind: "verbatim"; text: string };

export interface ParsedCardFile {
  frontmatter: Record<string, unknown>;
  /** Exact frontmatter block including delimiters, or "" when there is none. */
  frontmatterText: string;
  deck: string | null;
  note: string | null;
  noteSha: string | null;
  cards: ParsedCard[];
  /** Sections that looked like cards but could not be parsed; still kept verbatim. */
  malformed: MalformedCardSection[];
  /** Body content in file order, so serialization is lossless. */
  blocks: CardFileBlock[];
}

function isCardStatus(value: string | undefined): value is CardStatus {
  return value !== undefined && (CARD_STATUSES as readonly string[]).includes(value);
}

function isCardType(value: string | undefined): value is CardType {
  return value !== undefined && (CARD_TYPES as readonly string[]).includes(value);
}

function parseAnkiId(value: string | undefined): number | null {
  if (value === undefined) return null;
  const id = Number.parseInt(value.trim(), 10);
  return Number.isFinite(id) && id >= 0 ? id : null;
}

/** `ok` or `rule 4 (too many facts)`; anything else is a reject carrying the raw reason. */
export function parseCritic(value: string | undefined): CardCritic | null {
  if (value === undefined) return null;
  const text = value.trim();
  if (text === "") return null;
  if (text === "ok") return { verdict: "ok" };
  const rule = /^rule\s+(\d+)\s*(?:\(([^)]*)\))?\s*$/i.exec(text);
  if (rule !== null) {
    const ruleNumber = Number.parseInt(rule[1] ?? "", 10);
    const reason = rule[2]?.trim();
    return {
      verdict: "reject",
      ...(Number.isFinite(ruleNumber) ? { rule: ruleNumber } : {}),
      ...(reason === undefined || reason === "" ? {} : { reason }),
    };
  }
  return { verdict: "reject", reason: text };
}

export function renderCritic(critic: CardCritic): string {
  if (critic.verdict === "ok") return "ok";
  const reason = critic.reason === undefined || critic.reason === "" ? undefined : critic.reason;
  if (critic.rule === undefined) return reason ?? "reject";
  return reason === undefined ? `rule ${critic.rule}` : `rule ${critic.rule} (${reason})`;
}

function parseCommentFields(comment: string): CardCommentField[] {
  const inner = comment.replace(/^<!--/, "").replace(/-->$/, "").trim();
  if (inner === "") return [];
  const fields: CardCommentField[] = [];
  for (const part of inner.split(SEPARATOR)) {
    const trimmed = part.trim();
    if (trimmed === "") continue;
    const colon = trimmed.indexOf(":");
    if (colon === -1) {
      fields.push({ key: trimmed, value: "" });
      continue;
    }
    fields.push({ key: trimmed.slice(0, colon).trim(), value: trimmed.slice(colon + 1).trim() });
  }
  return fields;
}

function parseBodyFields(body: string): Record<CardBodyField, string | null> {
  const values: Record<CardBodyField, string[] | null> = { q: null, a: null, text: null, extra: null };
  let current: CardBodyField | null = null;
  for (const line of body.split("\n")) {
    const match = BODY_FIELD.exec(line);
    if (match !== null) {
      const label = match[1];
      current = label === "Q" ? "q" : label === "A" ? "a" : label === "Text" ? "text" : "extra";
      values[current] = [match[2] ?? ""];
      continue;
    }
    if (current !== null) values[current]?.push(line);
  }
  const joined = (field: CardBodyField): string | null => {
    const lines = values[field];
    return lines === null ? null : lines.join("\n").replace(/[ \t\r\n]+$/, "");
  };
  return { q: joined("q"), a: joined("a"), text: joined("text"), extra: joined("extra") };
}

interface CardCore {
  id: string;
  head: string;
  comment: string;
  body: string;
  raw: string;
  fields: CardCommentField[];
}

function toCore(card: ParsedCard): CardCore {
  return {
    id: card.id,
    head: card.head,
    comment: card.comment,
    body: card.body,
    raw: card.raw,
    fields: card.fields,
  };
}

function finalize(core: CardCore): ParsedCard {
  const get = (key: string): string | undefined => core.fields.find((field) => field.key === key)?.value;
  const status = get("status");
  const type = get("type");
  const body = parseBodyFields(core.body);
  return {
    ...core,
    status: isCardStatus(status) ? status : null,
    type: isCardType(type) ? type : null,
    q: body.q,
    a: body.a,
    text: body.text,
    extra: body.extra,
    src: get("src") ?? null,
    ankiId: parseAnkiId(get("anki")),
    critic: parseCritic(get("critic")),
  };
}

export function renderCardComment(fields: CardCommentField[]): string {
  const inner = fields.map((field) => `${field.key}: ${field.value}`).join(` ${SEPARATOR} `);
  return `<!-- ${inner} -->`;
}

function renderCardSectionText(head: string, comment: string, body: string): string {
  return `${head}\n${comment === "" ? "" : `${comment}\n`}${body}`;
}

/** Set (or append) a comment key, preserving the order of existing keys. */
export function setCardCommentField(card: ParsedCard, key: string, value: string): ParsedCard {
  const fields = card.fields.map((field) => ({ ...field }));
  const existing = fields.find((field) => field.key === key);
  if (existing !== undefined) existing.value = value;
  else fields.push({ key, value });
  const comment = renderCardComment(fields);
  return finalize({
    ...toCore(card),
    comment,
    raw: renderCardSectionText(card.head, comment, card.body),
    fields,
  });
}

function replaceBodyField(body: string, field: CardBodyField, value: string): string {
  const label = BODY_LABELS[field];
  const pattern = new RegExp(`^\\*\\*${label}:\\*\\*[^\\n]*$`, "m");
  if (!pattern.test(body)) throw new Error(`card body has no **${label}:** line`);
  return body.replace(pattern, `**${label}:** ${value}`);
}

/** Replace one body line (`**Q:**`, `**A:**`, `**Text:**`, `**Extra:**`) in place. */
export function setCardBodyField(card: ParsedCard, field: CardBodyField, value: string): ParsedCard {
  const body = replaceBodyField(card.body, field, value);
  return finalize({ ...toCore(card), body, raw: renderCardSectionText(card.head, card.comment, body) });
}

function splitSection(section: string, heading: string): { comment: string; body: string } {
  const afterHeading = section.slice(heading.length).replace(/^\r?\n/, "");
  const match = COMMENT_LINE.exec(afterHeading);
  if (match === null) return { comment: "", body: afterHeading };
  return { comment: (match[1] ?? "").trim(), body: afterHeading.slice(match[0].length) };
}

export function parseCardFile(text: string): ParsedCardFile {
  const { frontmatter, body } = parseFrontmatter(text);
  const frontmatterText = text.slice(0, text.length - body.length);

  const blocks: CardFileBlock[] = [];
  const cards: ParsedCard[] = [];
  const malformed: MalformedCardSection[] = [];

  const matches = [...body.matchAll(HEADING)];
  const first = matches[0];
  if (first?.index !== undefined && first.index > 0) {
    blocks.push({ kind: "verbatim", text: body.slice(0, first.index) });
  }

  for (let index = 0; index < matches.length; index++) {
    const match = matches[index];
    if (match === undefined || match.index === undefined) continue;
    const start = match.index;
    const end = matches[index + 1]?.index ?? body.length;
    const section = body.slice(start, end);
    const heading = match[1] ?? "";
    if (!CARD_ID_PATTERN.test(heading)) {
      blocks.push({ kind: "verbatim", text: section });
      continue;
    }

    const { comment, body: sectionBody } = splitSection(section, match[0]);
    const fields = parseCommentFields(comment);
    const card = finalize({ id: heading, head: match[0], comment, body: sectionBody, raw: section, fields });
    if (card.status === null || card.type === null) {
      malformed.push({
        heading,
        reason:
          card.status === null && card.type === null
            ? "missing status and type"
            : card.status === null
              ? "missing or unknown status"
              : "missing or unknown type",
        raw: section,
      });
      blocks.push({ kind: "verbatim", text: section });
      continue;
    }
    cards.push(card);
    blocks.push({ kind: "card", card });
  }

  const deck = typeof frontmatter.deck === "string" ? frontmatter.deck : null;
  const note = typeof frontmatter.note === "string" ? frontmatter.note : null;
  const noteSha = typeof frontmatter.note_sha === "string" ? frontmatter.note_sha : null;

  return { frontmatter, frontmatterText, deck, note, noteSha, cards, malformed, blocks };
}

export function serializeCardFile(file: ParsedCardFile): string {
  const body = file.blocks.map((block) => (block.kind === "verbatim" ? block.text : block.card.raw)).join("");
  return file.frontmatterText + body;
}

export function toCardView(card: ParsedCard): CardView {
  if (card.status === null || card.type === null) {
    throw new Error(`card ${card.id} is missing its status or type`);
  }
  const view: CardView = { id: card.id, type: card.type, status: card.status };
  if (card.q !== null) view.q = card.q;
  if (card.a !== null) view.a = card.a;
  if (card.text !== null) view.text = card.text;
  if (card.extra !== null) view.extra = card.extra;
  if (card.src !== null) view.src = card.src;
  if (card.critic !== null) view.critic = card.critic;
  if (card.ankiId !== null) view.ankiId = card.ankiId;
  return view;
}

export function countCardStatuses(cards: readonly ParsedCard[]): Record<CardStatus, number> {
  const counts: Record<CardStatus, number> = { draft: 0, approved: 0, rejected: 0, exported: 0 };
  for (const card of cards) {
    if (card.status !== null) counts[card.status] += 1;
  }
  return counts;
}
