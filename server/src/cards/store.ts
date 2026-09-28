import { promises as fs } from "node:fs";
import type { CardFileDetail, CardFileView, CardPatch, CardView } from "@studium/shared";
import {
  countCardStatuses,
  type ParsedCard,
  parseCardFile,
  setCardBodyField,
  setCardCommentField,
  toCardView,
} from "@studium/shared";
import { editFile } from "../tree/edit.js";
import { commitPaths, log } from "../tree/git.js";
import type { FileLocks } from "../tree/lock.js";
import { resolveInRoot } from "../tree/paths.js";

/**
 * Reads and mutates `<set>/cards/NN-slug.md`. Card edits are exact-string
 * replacements of one card section; the store never rewrites the whole file.
 * Learner actions are committed with author `user`.
 */

/** `cards/NN-slug.md` as used in request paths. */
export const CARD_FILE_PATH = /^cards\/[0-9]{2,}-[a-z0-9][a-z0-9-]*\.md$/;
export const CARD_FILE_NAME = /^[0-9]{2,}-[a-z0-9][a-z0-9-]*\.md$/;
const NOTE_PATH = /^notes\/[0-9]{2,}-[a-z0-9][a-z0-9-]*\.md$/;
export const CARD_ID = /^c-[0-9a-f]{4,}$/;

/** How many commits touching the note we scan when computing `noteCommitsSince`. */
const STALE_LOG_LIMIT = 100;

export type CardStoreErrorCode = "not_found" | "invalid" | "malformed" | "no_change";

export class CardStoreError extends Error {
  readonly code: CardStoreErrorCode;

  constructor(code: CardStoreErrorCode, message: string) {
    super(message);
    this.name = "CardStoreError";
    this.code = code;
  }
}

export interface CommitResult {
  sha: string | null;
  subject: string;
}

function isCardPatchStatus(value: unknown): value is NonNullable<CardPatch["status"]> {
  return value === "draft" || value === "approved" || value === "rejected";
}

async function cardFileNames(root: string, set: string): Promise<string[]> {
  let entries: string[];
  try {
    entries = await fs.readdir(resolveInRoot(root, `${set}/cards`));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return [];
    throw error;
  }
  return entries.filter((name) => CARD_FILE_NAME.test(name)).sort();
}

/** Last commit sha touching a root-relative note path, or null when unknown. */
export async function noteCommitSha(root: string, noteRootRel: string): Promise<string | null> {
  try {
    const commits = await log(root, { path: noteRootRel, limit: 1 });
    return commits[0]?.sha ?? null;
  } catch {
    return null;
  }
}

async function staleInfo(
  root: string,
  set: string,
  note: string | null,
  noteSha: string | null,
): Promise<{ stale: boolean; noteCommitsSince: number }> {
  if (note === null || noteSha === null || !NOTE_PATH.test(note)) {
    return { stale: false, noteCommitsSince: 0 };
  }
  let commits: { sha: string }[];
  try {
    commits = await log(root, { path: `${set}/${note}`, limit: STALE_LOG_LIMIT });
  } catch {
    return { stale: false, noteCommitsSince: 0 };
  }
  const latest = commits[0]?.sha;
  if (latest === undefined || latest === noteSha) return { stale: false, noteCommitsSince: 0 };
  const index = commits.findIndex((commit) => commit.sha === noteSha);
  return { stale: true, noteCommitsSince: index === -1 ? commits.length : index };
}

async function readCardText(root: string, set: string, name: string): Promise<string> {
  return fs.readFile(resolveInRoot(root, `${set}/cards/${name}`), "utf8");
}

/** One `CardFileView` per card file, with derived stale info and status counts. */
export async function listCardFiles(root: string, set: string): Promise<CardFileView[]> {
  const names = await cardFileNames(root, set);
  return Promise.all(
    names.map(async (name) => {
      const text = await readCardText(root, set, name);
      const parsed = parseCardFile(text);
      const { stale, noteCommitsSince } = await staleInfo(root, set, parsed.note, parsed.noteSha);
      return {
        path: `cards/${name}`,
        note: parsed.note,
        deck: parsed.deck,
        stale,
        noteCommitsSince,
        counts: countCardStatuses(parsed.cards),
      };
    }),
  );
}

/** `GET /api/sets/:set/cards/file?path=cards/NN-slug.md`, or null when absent. */
export async function readCardFile(root: string, set: string, rel: string): Promise<CardFileDetail | null> {
  if (!CARD_FILE_PATH.test(rel)) throw new CardStoreError("invalid", `invalid card path: ${rel}`);
  const name = rel.slice("cards/".length);
  let text: string;
  try {
    text = await readCardText(root, set, name);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }
  const parsed = parseCardFile(text);
  const { stale } = await staleInfo(root, set, parsed.note, parsed.noteSha);
  return {
    path: rel,
    note: parsed.note,
    deck: parsed.deck,
    stale,
    cards: parsed.cards.map(toCardView),
  };
}

interface FoundCard {
  /** Root-relative path, e.g. `linear-algebra/cards/03-svd.md`. */
  rootRel: string;
  card: ParsedCard;
}

async function findCard(root: string, set: string, id: string): Promise<FoundCard | null> {
  if (!CARD_ID.test(id)) throw new CardStoreError("invalid", `invalid card id: ${id}`);
  for (const name of await cardFileNames(root, set)) {
    const text = await readCardText(root, set, name);
    const parsed = parseCardFile(text);
    const card = parsed.cards.find((candidate) => candidate.id === id);
    if (card !== undefined) {
      return { rootRel: `${set}/cards/${name}`, card };
    }
    if (parsed.malformed.some((section) => section.heading === id)) {
      throw new CardStoreError("malformed", `card has no valid status or type: ${id}`);
    }
  }
  return null;
}

async function applySectionEdits(
  root: string,
  locks: FileLocks,
  holder: string,
  rootRel: string,
  edits: { old: string; next: string }[],
): Promise<void> {
  for (const edit of edits) {
    if (edit.old === edit.next) continue;
    await editFile(root, locks, holder, rootRel, edit.old, edit.next, {
      canWrite: (candidate) => candidate === rootRel,
    });
  }
}

/** Apply `PATCH /api/sets/:set/cards/:id`; returns the updated view and commit. */
export async function patchCard(
  root: string,
  locks: FileLocks,
  set: string,
  id: string,
  patch: CardPatch,
): Promise<{ card: CardView; commit: CommitResult }> {
  if (patch.status !== undefined && !isCardPatchStatus(patch.status)) {
    throw new CardStoreError("invalid", `invalid status: ${String(patch.status)}`);
  }
  const found = await findCard(root, set, id);
  if (found === null) throw new CardStoreError("not_found", `card not found: ${id}`);
  if (found.card.status === null || found.card.type === null) {
    throw new CardStoreError("malformed", `card has no valid status or type: ${id}`);
  }

  let next = found.card;
  if (patch.status !== undefined) next = setCardCommentField(next, "status", patch.status);
  if (patch.q !== undefined) next = setCardBodyField(next, "q", patch.q);
  if (patch.a !== undefined) next = setCardBodyField(next, "a", patch.a);
  if (patch.text !== undefined) next = setCardBodyField(next, "text", patch.text);
  if (patch.extra !== undefined) next = setCardBodyField(next, "extra", patch.extra);

  if (next.raw === found.card.raw) throw new CardStoreError("no_change", `no change for card ${id}`);

  await applySectionEdits(root, locks, `user:card:${crypto.randomUUID()}`, found.rootRel, [
    { old: found.card.raw, next: next.raw },
  ]);
  const subject = `user: update card ${id}`;
  const sha = await commitPaths(root, [found.rootRel], subject, "user");
  return { card: toCardView(next), commit: { sha, subject } };
}

/** Approve every `draft` card in one file whose critic verdict is `ok`. */
export async function approveCleanCards(
  root: string,
  locks: FileLocks,
  set: string,
  rel: string,
): Promise<{ approved: number; commit: CommitResult }> {
  if (!CARD_FILE_PATH.test(rel)) throw new CardStoreError("invalid", `invalid card path: ${rel}`);
  const name = rel.slice("cards/".length);
  let text: string;
  try {
    text = await readCardText(root, set, name);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      throw new CardStoreError("not_found", `card file not found: ${rel}`);
    }
    throw error;
  }

  const parsed = parseCardFile(text);
  const edits = parsed.cards
    .filter((card) => card.status === "draft" && card.critic?.verdict === "ok")
    .map((card) => ({ old: card.raw, next: setCardCommentField(card, "status", "approved").raw }));

  const subject = `user: approve ${edits.length} card${edits.length === 1 ? "" : "s"} in ${rel}`;
  if (edits.length === 0) return { approved: 0, commit: { sha: null, subject } };

  const rootRel = `${set}/${rel}`;
  await applySectionEdits(root, locks, `user:approve:${crypto.randomUUID()}`, rootRel, edits);
  const sha = await commitPaths(root, [rootRel], subject, "user");
  return { approved: edits.length, commit: { sha, subject } };
}

/** Record an Anki note id and mark cards `exported` (re-exporting `exported` is allowed). */
export async function markCardsExported(
  root: string,
  locks: FileLocks,
  set: string,
  ids: string[],
  ankiIds?: Record<string, number>,
): Promise<{ updated: number; commit: CommitResult }> {
  const editsByFile = new Map<string, { old: string; next: string }[]>();
  const holder = `user:exported:${crypto.randomUUID()}`;
  let updated = 0;

  for (const id of new Set(ids)) {
    const found = await findCard(root, set, id);
    if (found === null) throw new CardStoreError("not_found", `card not found: ${id}`);
    if (found.card.status !== "approved" && found.card.status !== "exported") {
      throw new CardStoreError("invalid", `card is not approved: ${id}`);
    }
    let next = setCardCommentField(found.card, "status", "exported");
    const ankiId = ankiIds?.[id];
    if (ankiId !== undefined) next = setCardCommentField(next, "anki", String(ankiId));
    if (next.raw === found.card.raw) continue;

    const edits = editsByFile.get(found.rootRel) ?? [];
    edits.push({ old: found.card.raw, next: next.raw });
    editsByFile.set(found.rootRel, edits);
    updated += 1;
  }

  const subject = `user: mark ${updated} card${updated === 1 ? "" : "s"} exported`;
  if (updated === 0) return { updated: 0, commit: { sha: null, subject } };

  const paths: string[] = [];
  for (const [rootRel, edits] of editsByFile) {
    await applySectionEdits(root, locks, holder, rootRel, edits);
    paths.push(rootRel);
  }
  const sha = await commitPaths(root, paths, subject, "user");
  return { updated, commit: { sha, subject } };
}
