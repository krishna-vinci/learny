import { promises as fs } from "node:fs";
import path from "node:path";
import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { parseCardFile, parseFrontmatter } from "@studium/shared";
import { rethrowRoleModelError, runRole } from "../agent/run-role.js";
import { noteCommitSha } from "../cards/store.js";
import type { EventHub } from "../events.js";
import type { McpManager } from "../mcp/bridge.js";
import { createFile, editFile, readText } from "../tree/edit.js";
import { commitPaths } from "../tree/git.js";
import type { FileLocks } from "../tree/lock.js";
import { resolveInRoot } from "../tree/paths.js";
import { isSetSlug } from "../tree/read.js";
import type { JobContext, JobHandler } from "./runner.js";
import { usageFromPiMessages } from "./runner.js";

const NOTE_PATH = /^notes\/([0-9]{2,}-[a-z0-9][a-z0-9-]*)\.md$/;
const CARD_FILE_NAME = /^[0-9]{2,}-[a-z0-9][a-z0-9-]*\.md$/;

export interface MakeCardsInput {
  kind?: "make-cards";
  set: string;
  note: string;
  count: number;
}

export interface CardsJobDeps {
  root: string;
  locks: FileLocks;
  mcp: McpManager;
  runtime: ModelRuntime;
  hub: EventHub;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseMakeCardsInput(value: unknown): MakeCardsInput {
  if (!isRecord(value)) throw new Error("invalid make-cards input");
  const set = typeof value.set === "string" ? value.set : "";
  const note = typeof value.note === "string" ? value.note : "";
  const count = value.count === undefined ? 12 : value.count;
  if (!isSetSlug(set)) throw new Error("invalid set");
  if (!NOTE_PATH.test(note)) throw new Error("invalid note path");
  if (typeof count !== "number" || !Number.isInteger(count) || count < 0 || count > 40) {
    throw new Error("count must be an integer from 0 to 40");
  }
  return { kind: "make-cards", set, note, count };
}

function cardPathFor(note: string): string {
  const match = NOTE_PATH.exec(note);
  if (match?.[1] === undefined) throw new Error("invalid note path");
  return `cards/${match[1]}.md`;
}

function titleOf(text: string, fallback: string): string {
  const title = parseFrontmatter(text).frontmatter.title;
  return typeof title === "string" && title.trim() !== "" ? title.trim() : fallback;
}

function noteStatus(text: string): string | null {
  const status = parseFrontmatter(text).frontmatter.status;
  return typeof status === "string" ? status : null;
}

async function optionalText(root: string, rel: string): Promise<string | null> {
  try {
    return await readText(root, rel);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "not_found") return null;
    throw error;
  }
}

async function deckSnapshot(root: string, set: string): Promise<string> {
  let names: string[];
  try {
    names = await fs.readdir(resolveInRoot(root, `${set}/cards`));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return "(no existing cards)";
    throw error;
  }
  const files = await Promise.all(
    names
      .filter((name) => CARD_FILE_NAME.test(name))
      .sort()
      .map(async (name) => `### cards/${name}\n${await readText(root, `${set}/cards/${name}`)}`),
  );
  return files.join("\n") || "(no existing cards)";
}

function makeInitialCardFile(deck: string, note: string, noteSha: string): string {
  return `---\ndeck: ${JSON.stringify(deck)}\nnote: ${note}\nnote_sha: ${noteSha}\n---\n`;
}

function cardsmithTask(input: MakeCardsInput, cardPath: string, note: string, existingDeck: string): string {
  return [
    "Load the make-deck skill and draft source-grounded cards for the accepted note.",
    `Target note: ${input.note}`,
    `Pinned target card file: ${cardPath}`,
    `Maximum new cards: ${input.count}`,
    "Call add_card for each new card. The tool generates every id; never invent an id.",
    "Do not edit existing cards during this drafting pass and do not write any other file.",
    "Approved and exported cards in the deck snapshot are established memories; do not duplicate them.",
    "",
    "## Target note",
    note,
    "",
    "## Existing deck",
    existingDeck,
  ].join("\n");
}

function criticTask(
  cardPath: string,
  ids: readonly string[],
  note: string,
  existingDeck: string,
  recheck: boolean,
): string {
  return [
    "Load the critique-cards skill and its twenty-rules reference.",
    `Target card file: ${cardPath}`,
    `Assigned card ids: ${ids.join(", ")}`,
    `This is ${recheck ? "a re-review after revision" : "the initial review"}.`,
    "Review every assigned id exactly once with review_card. Do not review or modify unassigned cards.",
    "Compare against the complete existing deck for interference and verify source support.",
    "",
    "## Target note",
    note,
    "",
    "## Existing deck",
    existingDeck,
  ].join("\n");
}

function revisionTask(cardPath: string, rejected: string[], sections: string): string {
  return [
    "Load the make-deck skill and revise the Critic-rejected cards in place.",
    `Pinned target card file: ${cardPath}`,
    `Rejected card ids: ${rejected.join(", ")}`,
    "Use study_edit only on those exact card sections. Preserve every card id and do not add cards.",
    "Do not change approved, exported, clean draft, or unassigned cards.",
    "",
    "## Rejected cards and findings",
    sections,
  ].join("\n");
}

async function setNoteSha(
  deps: Pick<CardsJobDeps, "root" | "locks">,
  cardRootPath: string,
  noteSha: string,
): Promise<void> {
  const text = await readText(deps.root, cardRootPath);
  const matches = text.match(/^note_sha:\s*[^\r\n]*$/gm) ?? [];
  if (matches.length !== 1 || matches[0] === undefined)
    throw new Error("card file must have exactly one note_sha line");
  if (matches[0] === `note_sha: ${noteSha}`) return;
  await editFile(
    deps.root,
    deps.locks,
    `critic:${crypto.randomUUID()}`,
    cardRootPath,
    matches[0],
    `note_sha: ${noteSha}`,
    {
      canWrite: (candidate) => candidate === cardRootPath,
    },
  );
}

function assertRevisionScope(beforeText: string, afterText: string, rejected: Set<string>): void {
  const before = parseCardFile(beforeText);
  const after = parseCardFile(afterText);
  if (before.cards.length !== after.cards.length) throw new Error("revision must not add or remove cards");
  const afterById = new Map(after.cards.map((card) => [card.id, card]));
  for (const card of before.cards) {
    const next = afterById.get(card.id);
    if (next === undefined) throw new Error(`revision removed or changed card id ${card.id}`);
    if (!rejected.has(card.id) && next.raw !== card.raw) throw new Error(`revision changed unassigned card ${card.id}`);
  }
}

export function createCardsJob(deps: CardsJobDeps): JobHandler {
  return async (rawInput: unknown, ctx: JobContext) => {
    const input = parseMakeCardsInput(rawInput);
    const noteRootPath = `${input.set}/${input.note}`;
    const cardPath = cardPathFor(input.note);
    const cardRootPath = `${input.set}/${cardPath}`;
    const [note, plan, noteSha] = await Promise.all([
      readText(deps.root, noteRootPath),
      readText(deps.root, `${input.set}/PLAN.md`),
      noteCommitSha(deps.root, noteRootPath),
    ]);
    if (noteStatus(note) !== "accepted") throw new Error("cards can only be made from an accepted note");
    if (noteSha === null) throw new Error("the target note has no commit sha");
    const noteTitle = titleOf(note, path.basename(input.note, ".md"));

    let cardText = await optionalText(deps.root, cardRootPath);
    if (cardText === null) {
      if (input.count === 0) throw new Error("cannot re-check cards because the target card file does not exist");
      const deck = `${titleOf(plan, input.set)}::${noteTitle}`;
      cardText = makeInitialCardFile(deck, input.note, noteSha);
      await createFile(deps.root, deps.locks, `cardsmith:${crypto.randomUUID()}`, cardRootPath, cardText, {
        canWrite: (candidate) => candidate === cardRootPath,
      });
    } else {
      const parsed = parseCardFile(cardText);
      if (parsed.note !== input.note) throw new Error(`card file note does not match ${input.note}`);
      if (parsed.malformed.length > 0)
        throw new Error(`card file contains malformed card ${parsed.malformed[0]?.heading}`);
    }

    let lastCommit: string | null = null;
    const publishCommit = (sha: string | null, subject: string, author: "cardsmith" | "critic") => {
      if (sha === null) return;
      lastCommit = sha;
      deps.hub.publish({ type: "commit", sha, subject, author });
    };
    let lastCardsmithText = "";
    const runCardsmith = async (task: string, maxAdds: number, allowEdits: boolean, addedIds: string[]) => {
      ctx.signal.throwIfAborted();
      const result = await runRole("cardsmith", {
        root: deps.root,
        set: input.set,
        task,
        locks: deps.locks,
        mcp: deps.mcp,
        runtime: deps.runtime,
        hub: deps.hub,
        signal: ctx.signal,
        canWrite: allowEdits ? (candidate) => candidate === cardRootPath : () => false,
        onModel: (provider) => ctx.useProvider?.(provider),
        onFallback: (_from, to) => ctx.progress(`Cardsmith model rate-limited; using ${to}`),
        onWrite: () => {},
        cards: { rootPath: cardRootPath, maxAdds, onAdd: (id) => addedIds.push(id) },
      }).catch(rethrowRoleModelError);
      ctx.addUsage(usageFromPiMessages(result.messages));
      lastCardsmithText = result.text.trim().slice(0, 300);
      if (result.written.some((written) => written !== cardRootPath)) {
        throw new Error(`cardsmith must only edit ${cardPath}`);
      }
    };
    const runCritic = async (ids: string[], recheck: boolean) => {
      if (ids.length === 0) return;
      ctx.signal.throwIfAborted();
      const reviewed = new Set<string>();
      const result = await runRole("critic", {
        root: deps.root,
        set: input.set,
        task: criticTask(cardPath, ids, note, await deckSnapshot(deps.root, input.set), recheck),
        locks: deps.locks,
        mcp: deps.mcp,
        runtime: deps.runtime,
        hub: deps.hub,
        signal: ctx.signal,
        canWrite: () => false,
        onModel: (provider) => ctx.useProvider?.(provider),
        onFallback: (_from, to) => ctx.progress(`Critic model rate-limited; using ${to}`),
        onWrite: () => {},
        cards: { rootPath: cardRootPath, allowedIds: ids, onReview: (id) => reviewed.add(id) },
      }).catch(rethrowRoleModelError);
      ctx.addUsage(usageFromPiMessages(result.messages));
      const missing = ids.filter((id) => !reviewed.has(id));
      if (missing.length > 0) throw new Error(`critic did not review assigned cards: ${missing.join(", ")}`);
    };

    const addedIds: string[] = [];
    if (input.count > 0) {
      ctx.progress("Drafting cards");
      await runCardsmith(
        cardsmithTask(input, cardPath, note, await deckSnapshot(deps.root, input.set)),
        input.count,
        false,
        addedIds,
      );
      ctx.signal.throwIfAborted();
      if (addedIds.length === 0)
        throw new Error("Cardsmith added no cards (every add_card call failed or none was made)");
      const subject = `cardsmith: ${noteTitle}`;
      const sha = await commitPaths(deps.root, [cardRootPath], subject, "cardsmith");
      publishCommit(sha, subject, "cardsmith");
    }

    const assigned =
      input.count === 0
        ? parseCardFile(await readText(deps.root, cardRootPath)).cards.map((card) => card.id)
        : addedIds;
    if (assigned.length > 0) {
      ctx.progress(input.count === 0 ? "Re-checking cards" : "Critiquing cards");
      await runCritic(assigned, false);
    }

    const reviewedText = await readText(deps.root, cardRootPath);
    const rejected = parseCardFile(reviewedText)
      .cards.filter((card) => assigned.includes(card.id) && card.status === "rejected")
      .map((card) => card.id);

    if (rejected.length > 0 && input.count > 0) {
      ctx.signal.throwIfAborted();
      const firstCriticSubject = `critic: review ${noteTitle}`;
      publishCommit(
        await commitPaths(deps.root, [cardRootPath], firstCriticSubject, "critic"),
        firstCriticSubject,
        "critic",
      );

      ctx.progress("Revising rejected cards");
      const beforeRevision = await readText(deps.root, cardRootPath);
      const parsed = parseCardFile(beforeRevision);
      const sections = parsed.cards
        .filter((card) => rejected.includes(card.id))
        .map((card) => card.raw)
        .join("\n");
      await runCardsmith(revisionTask(cardPath, rejected, sections), 0, true, []);
      const afterRevision = await readText(deps.root, cardRootPath);
      assertRevisionScope(beforeRevision, afterRevision, new Set(rejected));
      ctx.signal.throwIfAborted();
      const revisionSubject = `cardsmith: revise ${noteTitle}`;
      publishCommit(
        await commitPaths(deps.root, [cardRootPath], revisionSubject, "cardsmith"),
        revisionSubject,
        "cardsmith",
      );

      ctx.progress("Re-checking revised cards");
      await runCritic(rejected, true);
    }

    ctx.signal.throwIfAborted();
    await setNoteSha(deps, cardRootPath, noteSha);
    const criticSubject = `critic: ${noteTitle}`;
    publishCommit(await commitPaths(deps.root, [cardRootPath], criticSubject, "critic"), criticSubject, "critic");
    ctx.progress("Cards ready for approval");
    return { notePath: input.note, cardPath, ...(lastCommit === null ? {} : { commitSha: lastCommit }) };
  };
}
