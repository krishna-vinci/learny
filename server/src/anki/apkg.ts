/**
 * Legacy Anki 2.1 package writer.
 *
 * Assumptions mirrored from the documented schema-11 collection format used by
 * minimal genanki packages: `sfld` retains SQLite's historical INTEGER affinity
 * while storing the first field text, collection/model/deck metadata is JSON in
 * `col`, and new cards use queue/type zero with an empty revlog and graves table.
 */
import { createHash } from "node:crypto";
import { CARD_ID_PATTERN } from "@studium/shared";
import JSZip from "jszip";
import initSqlJs from "sql.js";
import { escapeHtml, markdownToAnkiHtml } from "./html.js";

export interface ExportCard {
  id: string;
  type: "basic" | "cloze";
  q?: string;
  a?: string;
  text?: string;
  extra?: string;
  src?: string;
  deck: string;
  notePath: string;
}

export interface ApkgOptions {
  set?: string;
  baseUrl?: string | null;
  sourceLabels?: Readonly<Record<string, string>>;
  now?: Date;
}

export class AnkiPackageInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AnkiPackageInputError";
  }
}

const FIELD_SEPARATOR = "\x1f";
const BASIC_MODEL_NAME = "Studium Basic";
const CLOZE_MODEL_NAME = "Studium Cloze";
const ZIP_DATE = new Date("1980-01-01T00:00:00.000Z");

const COLLECTION_SCHEMA = `
CREATE TABLE col (
  id integer primary key,
  crt integer not null,
  mod integer not null,
  scm integer not null,
  ver integer not null,
  dty integer not null,
  usn integer not null,
  ls integer not null,
  conf text not null,
  models text not null,
  decks text not null,
  dconf text not null,
  tags text not null
);
CREATE TABLE notes (
  id integer primary key,
  guid text not null,
  mid integer not null,
  mod integer not null,
  usn integer not null,
  tags text not null,
  flds text not null,
  sfld integer not null,
  csum integer not null,
  flags integer not null,
  data text not null
);
CREATE TABLE cards (
  id integer primary key,
  nid integer not null,
  did integer not null,
  ord integer not null,
  mod integer not null,
  usn integer not null,
  type integer not null,
  queue integer not null,
  due integer not null,
  ivl integer not null,
  factor integer not null,
  reps integer not null,
  lapses integer not null,
  left integer not null,
  odue integer not null,
  odid integer not null,
  flags integer not null,
  data text not null
);
CREATE TABLE revlog (
  id integer primary key,
  cid integer not null,
  usn integer not null,
  ease integer not null,
  ivl integer not null,
  lastIvl integer not null,
  factor integer not null,
  time integer not null,
  type integer not null
);
CREATE TABLE graves (
  usn integer not null,
  oid integer not null,
  type integer not null
);
CREATE INDEX ix_notes_usn ON notes (usn);
CREATE INDEX ix_cards_usn ON cards (usn);
CREATE INDEX ix_revlog_usn ON revlog (usn);
CREATE INDEX ix_cards_nid ON cards (nid);
CREATE INDEX ix_cards_sched ON cards (did, queue, due);
`;

function sha1(value: string): string {
  return createHash("sha1").update(value, "utf8").digest("hex");
}

/** Stable positive integer within JavaScript's exact integer range. */
export function stableAnkiId(namespace: string, value: string): number {
  return Number(BigInt(`0x${sha1(`${namespace}\0${value}`).slice(0, 13)}`)) + 2;
}

export function fieldChecksum(sortField: string): number {
  return Number.parseInt(sha1(sortField).slice(0, 8), 16);
}

function modelField(name: string, ord: number) {
  return { name, ord, sticky: false, rtl: false, font: "Arial", size: 20, media: [] };
}

function modelTemplate(name: string, qfmt: string, afmt: string) {
  return { name, ord: 0, qfmt, afmt, did: null, bqfmt: "", bafmt: "" };
}

function modelJson(name: typeof BASIC_MODEL_NAME | typeof CLOZE_MODEL_NAME, nowSeconds: number) {
  const basic = name === BASIC_MODEL_NAME;
  const fields = (
    basic ? ["Front", "Back", "CardId", "Source", "NoteLink"] : ["Text", "Extra", "CardId", "Source", "NoteLink"]
  ).map(modelField);
  const template = basic
    ? modelTemplate(
        "Card 1",
        "{{Front}}",
        '{{FrontSide}}\n\n<hr id="answer">\n\n{{Back}}<div class="studium-meta">{{Source}} · {{NoteLink}}</div>',
      )
    : modelTemplate(
        "Cloze",
        "{{cloze:Text}}",
        '{{cloze:Text}}<br>{{Extra}}<div class="studium-meta">{{Source}} · {{NoteLink}}</div>',
      );
  return {
    id: stableAnkiId("model", name),
    name,
    type: basic ? 0 : 1,
    mod: nowSeconds,
    usn: -1,
    sortf: 0,
    did: null,
    tmpls: [template],
    flds: fields,
    css: ".card { font-family: Arial; font-size: 20px; text-align: left; color: black; background: white; }\n.studium-meta { margin-top: 1.5em; color: #666; font-size: 0.75em; }",
    latexPre:
      "\\documentclass[12pt]{article}\n\\special{papersize=3in,5in}\n\\usepackage[utf8]{inputenc}\n\\usepackage{amssymb,amsmath}\n\\pagestyle{empty}\n\\setlength{\\parindent}{0in}\n\\begin{document}",
    latexPost: "\\end{document}",
    req: [[0, "all", [0]]],
    tags: [],
    vers: [],
  };
}

function deckJson(name: string, nowSeconds: number) {
  return {
    id: stableAnkiId("deck", name),
    name,
    mod: nowSeconds,
    usn: -1,
    desc: "",
    dyn: 0,
    collapsed: false,
    browserCollapsed: false,
    conf: 1,
    extendNew: 0,
    extendRev: 0,
    newToday: [0, 0],
    revToday: [0, 0],
    lrnToday: [0, 0],
    timeToday: [0, 0],
  };
}

function defaultDeck(nowSeconds: number) {
  return { ...deckJson("Default", nowSeconds), id: 1 };
}

function deckMap(cards: ExportCard[], nowSeconds: number): Record<string, ReturnType<typeof deckJson>> {
  const decks: Record<string, ReturnType<typeof deckJson>> = { "1": defaultDeck(nowSeconds) };
  const names = new Set<string>();
  for (const card of cards) {
    const segments = card.deck.split("::");
    for (let index = 1; index <= segments.length; index++) names.add(segments.slice(0, index).join("::"));
  }
  for (const name of [...names].sort()) {
    const deck = deckJson(name, nowSeconds);
    decks[String(deck.id)] = deck;
  }
  return decks;
}

function defaultDeckConfig(nowSeconds: number) {
  return {
    "1": {
      id: 1,
      name: "Default",
      mod: nowSeconds,
      usn: -1,
      dyn: false,
      maxTaken: 60,
      autoplay: true,
      timer: 0,
      replayq: true,
      new: { bury: true, delays: [1, 10], initialFactor: 2500, ints: [1, 4], order: 1, perDay: 20 },
      rev: { bury: true, ease4: 1.3, fuzz: 0.05, ivlFct: 1, maxIvl: 36500, perDay: 200, hardFactor: 1.2 },
      lapse: { delays: [10], leechAction: 0, leechFails: 8, minInt: 1, mult: 0 },
    },
  };
}

function clozeOrdinals(text: string): number[] {
  const ordinals = new Set<number>();
  for (const match of text.matchAll(/{{c(\d+)::/gi)) {
    const ordinal = Number.parseInt(match[1] ?? "", 10);
    if (ordinal > 0) ordinals.add(ordinal - 1);
  }
  return [...ordinals].sort((a, b) => a - b);
}

function noteLink(card: ExportCard, options: ApkgOptions): string {
  const baseUrl = options.baseUrl?.replace(/\/+$/, "");
  if (baseUrl === undefined || baseUrl === "" || options.set === undefined) return escapeHtml(card.notePath);
  const noteRest = card.notePath.replace(/^notes\//, "");
  const href = `${baseUrl}/s/${encodeURIComponent(options.set)}/n/${noteRest
    .split("/")
    .map(encodeURIComponent)
    .join("/")}`;
  return `<a href="${escapeHtml(href)}">${escapeHtml(card.notePath)}</a>`;
}

function sourceId(source: string | undefined): string | null {
  if (source === undefined || source === "") return null;
  return source.split("#", 1)[0] ?? null;
}

function sourceField(card: ExportCard, options: ApkgOptions): string {
  if (card.src === undefined) return "";
  return escapeHtml(options.sourceLabels?.[card.src] ?? card.src);
}

function noteTags(card: ExportCard, options: ApkgOptions): string {
  const tags = ["studium"];
  if (options.set !== undefined) tags.push(`set::${options.set}`);
  const source = sourceId(card.src);
  if (source !== null) tags.push(`src::${source}`);
  return ` ${tags.join(" ")} `;
}

function validateCards(cards: ExportCard[]): void {
  const ids = new Set<string>();
  for (const card of cards) {
    if (!CARD_ID_PATTERN.test(card.id)) {
      throw new AnkiPackageInputError(`Card id ${card.id} must match c- followed by 8 lowercase hex characters`);
    }
    if (ids.has(card.id)) throw new AnkiPackageInputError(`Duplicate card id: ${card.id}`);
    ids.add(card.id);
    if (card.deck.trim() === "") throw new AnkiPackageInputError(`Card ${card.id} has no deck`);
    if (card.type === "basic" && (card.q === undefined || card.a === undefined)) {
      throw new AnkiPackageInputError(`Basic card ${card.id} requires q and a`);
    }
    if (card.type === "cloze" && card.text === undefined) {
      throw new AnkiPackageInputError(`Cloze card ${card.id} requires text`);
    }
    if (card.type === "cloze" && clozeOrdinals(card.text ?? "").length === 0) {
      throw new AnkiPackageInputError(`Cloze card ${card.id} requires at least one {{cN::}} deletion`);
    }
  }
}

/** Build an importable `.apkg` archive containing `collection.anki2` and `media`. */
export async function createApkg(cards: ExportCard[], options: ApkgOptions = {}): Promise<Uint8Array> {
  validateCards(cards);
  const now = options.now ?? new Date();
  const nowSeconds = Math.floor(now.getTime() / 1000);
  const nowMilliseconds = now.getTime();
  const decks = deckMap(cards, nowSeconds);
  const basicModel = modelJson(BASIC_MODEL_NAME, nowSeconds);
  const clozeModel = modelJson(CLOZE_MODEL_NAME, nowSeconds);
  const models = { [String(basicModel.id)]: basicModel, [String(clozeModel.id)]: clozeModel };
  const usedDeckIds = cards.map((card) => stableAnkiId("deck", card.deck));
  const currentDeckId = usedDeckIds[0] ?? 1;

  const SQL = await initSqlJs();
  const db = new SQL.Database();
  try {
    db.run(COLLECTION_SCHEMA);
    db.run("INSERT INTO col VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      1,
      Math.floor(nowSeconds / 86_400) * 86_400,
      nowMilliseconds,
      nowMilliseconds,
      11,
      0,
      0,
      0,
      JSON.stringify({
        nextPos: cards.length + 1,
        estTimes: true,
        activeDecks: usedDeckIds.length === 0 ? [1] : [...new Set(usedDeckIds)],
        curDeck: currentDeckId,
        newSpread: 0,
        collapseTime: 1200,
        timeLim: 0,
        sortType: "noteFld",
        sortBackwards: false,
        addToCur: true,
      }),
      JSON.stringify(models),
      JSON.stringify(decks),
      JSON.stringify(defaultDeckConfig(nowSeconds)),
      "{}",
    ]);

    let due = 1;
    for (const card of cards) {
      const noteId = stableAnkiId("note", card.id);
      const modelId = card.type === "basic" ? basicModel.id : clozeModel.id;
      const fields =
        card.type === "basic"
          ? [
              markdownToAnkiHtml(card.q ?? ""),
              markdownToAnkiHtml(card.a ?? ""),
              escapeHtml(card.id),
              sourceField(card, options),
              noteLink(card, options),
            ]
          : [
              markdownToAnkiHtml(card.text ?? ""),
              markdownToAnkiHtml(card.extra ?? ""),
              escapeHtml(card.id),
              sourceField(card, options),
              noteLink(card, options),
            ];
      const sortField = fields[0] ?? "";
      db.run("INSERT INTO notes VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
        noteId,
        card.id,
        modelId,
        nowSeconds,
        -1,
        noteTags(card, options),
        fields.join(FIELD_SEPARATOR),
        sortField,
        fieldChecksum(sortField),
        0,
        "",
      ]);

      const ordinals = card.type === "basic" ? [0] : clozeOrdinals(card.text ?? "");
      for (const ordinal of ordinals) {
        db.run("INSERT INTO cards VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
          stableAnkiId("card", `${card.id}:${ordinal}`),
          noteId,
          stableAnkiId("deck", card.deck),
          ordinal,
          nowSeconds,
          -1,
          0,
          0,
          due++,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          0,
          "",
        ]);
      }
    }

    const zip = new JSZip();
    zip.file("collection.anki2", db.export(), { date: ZIP_DATE });
    zip.file("media", "{}", { date: ZIP_DATE });
    return await zip.generateAsync({ type: "uint8array", compression: "DEFLATE", platform: "UNIX" });
  } finally {
    db.close();
  }
}
