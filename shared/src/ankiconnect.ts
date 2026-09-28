/**
 * Minimal AnkiConnect client: `POST` JSON `{ action, version, params }` → `{ result, error }`.
 *
 * Deliberately free of DOM and Node type libraries so the same module compiles in the
 * browser bundle and on the server; the transport is injected. The note types, field
 * names and field content mirror the `.apkg` writer (server/src/anki/apkg.ts) so a synced
 * note and an exported note share a model and can update each other.
 */
import type { CardType } from "./api.js";

export const ANKICONNECT_VERSION = 6;

const DEFAULT_TIMEOUT_MS = 10_000;

/** The timer globals this module reaches for; typed locally to avoid DOM/Node libs. */
interface TimerGlobals {
  setTimeout?: (callback: () => void, milliseconds: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

interface AnkiFetchInit {
  method: string;
  headers: Record<string, string>;
  body: string;
}

interface AnkiFetchResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

/** Injected transport. Both the browser's and Node's `fetch` satisfy this shape. */
export type AnkiFetch = (url: string, init: AnkiFetchInit) => Promise<AnkiFetchResponse>;

/** Raised for a non-null `error` field, a transport failure, a timeout, or invalid JSON. */
export class AnkiConnectError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "AnkiConnectError";
  }
}

/** One Studium note type, kept in step with `server/src/anki/apkg.ts`. */
export interface AnkiModelSpec {
  name: string;
  fields: readonly string[];
  isCloze: boolean;
  css: string;
  templates: readonly { name: string; front: string; back: string }[];
}

const STUDIUM_CSS = [
  ".card { font-family: Arial; font-size: 20px; text-align: left; color: black; background: white; }",
  ".studium-meta { margin-top: 1.5em; color: #666; font-size: 0.75em; }",
].join("\n");

/** Note type names, field order, templates and cloze flag match the `.apkg` models exactly. */
export const STUDIUM_BASIC_MODEL: AnkiModelSpec = {
  name: "Studium Basic",
  fields: ["Front", "Back", "CardId", "Source", "NoteLink"],
  isCloze: false,
  css: STUDIUM_CSS,
  templates: [
    {
      name: "Card 1",
      front: "{{Front}}",
      back: '{{FrontSide}}\n\n<hr id="answer">\n\n{{Back}}<div class="studium-meta">{{Source}} \u00b7 {{NoteLink}}</div>',
    },
  ],
};

export const STUDIUM_CLOZE_MODEL: AnkiModelSpec = {
  name: "Studium Cloze",
  fields: ["Text", "Extra", "CardId", "Source", "NoteLink"],
  isCloze: true,
  css: STUDIUM_CSS,
  templates: [
    {
      name: "Cloze",
      front: "{{cloze:Text}}",
      back: '{{cloze:Text}}<br>{{Extra}}<div class="studium-meta">{{Source}} \u00b7 {{NoteLink}}</div>',
    },
  ],
};

export const STUDIUM_MODELS: readonly AnkiModelSpec[] = [STUDIUM_BASIC_MODEL, STUDIUM_CLOZE_MODEL];

/** The Studium note type a card of this type syncs into. */
export function modelForType(type: CardType): AnkiModelSpec {
  return type === "cloze" ? STUDIUM_CLOZE_MODEL : STUDIUM_BASIC_MODEL;
}

export interface AnkiNoteInfo {
  noteId: number;
  modelName: string;
  tags: string[];
  fields: Record<string, { value: string; order: number }>;
}

/** An `addNotes` request entry. */
export interface NewAnkiNote {
  deckName: string;
  modelName: string;
  fields: Record<string, string>;
  tags?: string[];
  options?: { allowDuplicate?: boolean };
}

/** The subset of AnkiConnect the sync runner uses; fakeable in tests. */
export interface AnkiClient {
  version(): Promise<number>;
  deckNames(): Promise<string[]>;
  createDeck(deck: string): Promise<number>;
  modelNames(): Promise<string[]>;
  createModel(spec: AnkiModelSpec): Promise<{ id: number }>;
  findNotes(query: string): Promise<number[]>;
  notesInfo(notes: readonly number[]): Promise<AnkiNoteInfo[]>;
  addNotes(notes: readonly NewAnkiNote[]): Promise<(number | null)[]>;
  updateNoteFields(noteId: number, fields: Record<string, string>): Promise<void>;
}

export interface AnkiConnectClientOptions {
  url: string;
  /** Defaults to the global `fetch`. */
  fetch?: AnkiFetch;
  /** Milliseconds before a request is abandoned. Defaults to 10s. */
  timeoutMs?: number;
}

export class AnkiConnectClient implements AnkiClient {
  readonly url: string;
  private readonly fetchImpl: AnkiFetch;
  private readonly timeoutMs: number;

  constructor(options: AnkiConnectClientOptions) {
    this.url = options.url;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const globalFetch = (globalThis as { fetch?: AnkiFetch }).fetch;
    const impl = options.fetch ?? globalFetch;
    if (impl === undefined) throw new AnkiConnectError("no fetch implementation available");
    this.fetchImpl = impl;
  }

  version(): Promise<number> {
    return this.request("version");
  }

  deckNames(): Promise<string[]> {
    return this.request("deckNames");
  }

  createDeck(deck: string): Promise<number> {
    return this.request("createDeck", { deck });
  }

  modelNames(): Promise<string[]> {
    return this.request("modelNames");
  }

  createModel(spec: AnkiModelSpec): Promise<{ id: number }> {
    return this.request("createModel", {
      modelName: spec.name,
      inOrderFields: [...spec.fields],
      css: spec.css,
      isCloze: spec.isCloze,
      cardTemplates: spec.templates.map((template) => ({
        Name: template.name,
        Front: template.front,
        Back: template.back,
      })),
    });
  }

  findNotes(query: string): Promise<number[]> {
    return this.request("findNotes", { query });
  }

  notesInfo(notes: readonly number[]): Promise<AnkiNoteInfo[]> {
    return this.request("notesInfo", { notes: [...notes] });
  }

  addNotes(notes: readonly NewAnkiNote[]): Promise<(number | null)[]> {
    return this.request("addNotes", { notes: [...notes] });
  }

  async updateNoteFields(noteId: number, fields: Record<string, string>): Promise<void> {
    await this.request("updateNoteFields", { note: { id: noteId, fields } });
  }

  private async request<T>(action: string, params: Record<string, unknown> = {}): Promise<T> {
    const body = JSON.stringify({ action, version: ANKICONNECT_VERSION, params });
    const response = await this.send(action, body);
    if (!response.ok) throw new AnkiConnectError(`AnkiConnect ${action} failed with HTTP ${response.status}`);
    let payload: unknown;
    try {
      payload = await response.json();
    } catch (cause) {
      throw new AnkiConnectError(`AnkiConnect ${action} returned invalid JSON`, { cause });
    }
    if (payload === null || typeof payload !== "object") {
      throw new AnkiConnectError(`AnkiConnect ${action} returned a malformed response`);
    }
    const { result, error } = payload as { result?: T; error?: unknown };
    if (error !== null && error !== undefined) {
      throw new AnkiConnectError(typeof error === "string" && error !== "" ? error : `AnkiConnect ${action} failed`);
    }
    return result as T;
  }

  private async send(action: string, body: string): Promise<AnkiFetchResponse> {
    let handle: unknown;
    const timer = new Promise<never>((_resolve, reject) => {
      handle = (globalThis as TimerGlobals).setTimeout?.(() => {
        reject(new AnkiConnectError(`AnkiConnect ${action} timed out after ${this.timeoutMs}ms`));
      }, this.timeoutMs);
    });
    try {
      return await Promise.race([
        this.fetchImpl(this.url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
        timer,
      ]);
    } catch (error) {
      if (error instanceof AnkiConnectError) throw error;
      throw new AnkiConnectError(`AnkiConnect ${action} request failed`, { cause: error });
    } finally {
      const clear = (globalThis as TimerGlobals).clearTimeout;
      if (clear !== undefined && handle !== undefined) clear(handle);
    }
  }
}

/** A card the planner and runner can act on. */
export interface SyncCard {
  id: string;
  type: CardType;
}

/** Cards missing from Anki go to `add`; cards already there go to `update`. */
export function planSync<T extends SyncCard>(
  cards: readonly T[],
  existing: Readonly<Record<string, number>>,
): { add: T[]; update: T[] } {
  const add: T[] = [];
  const update: T[] = [];
  for (const card of cards) {
    if (existing[card.id] === undefined) add.push(card);
    else update.push(card);
  }
  return { add, update };
}

/** The AnkiConnect query used everywhere to find a Studium card by its card id. */
export function cardIdQuery(cardId: string): string {
  return `CardId:${cardId}`;
}

export interface SyncFailure {
  id: string;
  error: string;
}

export interface SyncResult {
  added: number;
  updated: number;
  failed: SyncFailure[];
  ankiIds: Record<string, number>;
}

export interface SyncRunnerOptions<C extends SyncCard> {
  deckFor: (card: C) => string;
  toFields: (card: C) => Record<string, string>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message !== "" ? error.message : String(error);
}

/** Create any missing Studium note types. Throws when AnkiConnect itself is unreachable. */
async function ensureModels(client: AnkiClient): Promise<void> {
  const names = await client.modelNames();
  for (const model of STUDIUM_MODELS) {
    if (!names.includes(model.name)) await client.createModel(model);
  }
}

async function ensureDecks<C extends SyncCard>(
  client: AnkiClient,
  cards: readonly C[],
  deckFor: (card: C) => string,
): Promise<void> {
  const wanted = new Set(cards.map((card) => deckFor(card)));
  if (wanted.size === 0) return;
  const existing = new Set(await client.deckNames());
  for (const deck of wanted) {
    if (!existing.has(deck)) await client.createDeck(deck);
  }
}

/**
 * Reconcile `cards` with Anki: create the two Studium note types and the decks when
 * missing, add notes that have no `CardId:<id>` match, and update the ones that do.
 * Per-card failures are collected in `failed` instead of aborting the whole sync.
 */
export async function syncCards<C extends SyncCard>(
  client: AnkiClient,
  cards: readonly C[],
  options: SyncRunnerOptions<C>,
): Promise<SyncResult> {
  const failed: SyncFailure[] = [];
  const ankiIds: Record<string, number> = {};
  let added = 0;
  let updated = 0;

  await ensureModels(client);
  await ensureDecks(client, cards, options.deckFor);

  const missing: C[] = [];
  const present: { card: C; noteId: number }[] = [];
  for (const card of cards) {
    try {
      const [noteId] = await client.findNotes(cardIdQuery(card.id));
      if (noteId === undefined) missing.push(card);
      else present.push({ card, noteId });
    } catch (error) {
      failed.push({ id: card.id, error: errorMessage(error) });
    }
  }

  if (missing.length > 0) {
    try {
      const results = await client.addNotes(
        missing.map((card) => ({
          deckName: options.deckFor(card),
          modelName: modelForType(card.type).name,
          fields: options.toFields(card),
          // The CardId field is the identity; never let Anki's front-text duplicate
          // check reject a genuine Studium card.
          options: { allowDuplicate: true },
        })),
      );
      missing.forEach((card, index) => {
        const noteId = results[index];
        if (typeof noteId === "number") {
          added += 1;
          ankiIds[card.id] = noteId;
        } else {
          failed.push({ id: card.id, error: "AnkiConnect did not add the note" });
        }
      });
    } catch (error) {
      for (const card of missing) failed.push({ id: card.id, error: errorMessage(error) });
    }
  }

  for (const { card, noteId } of present) {
    try {
      await client.updateNoteFields(noteId, options.toFields(card));
      updated += 1;
      ankiIds[card.id] = noteId;
    } catch (error) {
      failed.push({ id: card.id, error: errorMessage(error) });
    }
  }

  return { added, updated, failed, ankiIds };
}
