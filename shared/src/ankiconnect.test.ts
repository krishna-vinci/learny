import { describe, expect, it } from "vitest";
import {
  type AnkiClient,
  AnkiConnectClient,
  AnkiConnectError,
  type AnkiFetch,
  cardIdQuery,
  modelForType,
  type NewAnkiNote,
  planSync,
  STUDIUM_BASIC_MODEL,
  STUDIUM_CLOZE_MODEL,
  type SyncCard,
  syncCards,
} from "./ankiconnect.js";

interface RequestBody {
  action: string;
  version: number;
  params: Record<string, unknown>;
}

function stubFetch(handler: (body: RequestBody) => { result?: unknown; error?: unknown }) {
  const calls: RequestBody[] = [];
  const fetchImpl: AnkiFetch = async (_url, init) => {
    const body = JSON.parse(init.body) as RequestBody;
    calls.push(body);
    const { result = null, error = null } = handler(body);
    return { ok: true, status: 200, json: async () => ({ result, error }) };
  };
  return { calls, fetchImpl };
}

describe("AnkiConnectClient", () => {
  it("posts { action, version, params } and returns the result", async () => {
    const { calls, fetchImpl } = stubFetch(() => ({ result: 6 }));
    const client = new AnkiConnectClient({ url: "http://localhost:8765", fetch: fetchImpl });

    await expect(client.version()).resolves.toBe(6);
    expect(calls).toEqual([{ action: "version", version: 6, params: {} }]);
  });

  it("throws when AnkiConnect reports an error", async () => {
    const { fetchImpl } = stubFetch(() => ({ result: null, error: "collection is not available" }));
    const client = new AnkiConnectClient({ url: "http://localhost:8765", fetch: fetchImpl });

    await expect(client.findNotes(cardIdQuery("c-8f3a1b2c"))).rejects.toThrow(AnkiConnectError);
    await expect(client.findNotes("CardId:c-8f3a1b2c")).rejects.toThrow(/collection is not available/);
  });

  it("abandons a request once the timeout elapses", async () => {
    const fetchImpl: AnkiFetch = () => new Promise(() => undefined);
    const client = new AnkiConnectClient({ url: "http://localhost:8765", fetch: fetchImpl, timeoutMs: 10 });

    await expect(client.deckNames()).rejects.toThrow(/timed out after 10ms/);
  });

  it("builds the two Studium note types with the apkg field names", async () => {
    const { calls, fetchImpl } = stubFetch(() => ({ result: { id: 1 } }));
    const client = new AnkiConnectClient({ url: "http://localhost:8765", fetch: fetchImpl });

    await client.createModel(STUDIUM_BASIC_MODEL);
    await client.createModel(STUDIUM_CLOZE_MODEL);

    expect(calls[0]?.params).toMatchObject({
      modelName: "Studium Basic",
      inOrderFields: ["Front", "Back", "CardId", "Source", "NoteLink"],
      isCloze: false,
    });
    expect(calls[1]?.params).toMatchObject({
      modelName: "Studium Cloze",
      inOrderFields: ["Text", "Extra", "CardId", "Source", "NoteLink"],
      isCloze: true,
    });
  });
});

describe("planSync", () => {
  const cards: SyncCard[] = [
    { id: "c-8f3a1b2c", type: "basic" },
    { id: "c-91bd07e4", type: "cloze" },
  ];

  it("splits cards into new adds and existing updates", () => {
    const { add, update } = planSync(cards, { "c-91bd07e4": 1712345678 });
    expect(add.map((card) => card.id)).toEqual(["c-8f3a1b2c"]);
    expect(update.map((card) => card.id)).toEqual(["c-91bd07e4"]);
  });

  it("treats every card as an add when Anki has none of them", () => {
    const { add, update } = planSync(cards, {});
    expect(add).toHaveLength(2);
    expect(update).toHaveLength(0);
  });
});

interface FakeAnki {
  client: AnkiClient;
  createdModels: string[];
  createdDecks: string[];
  added: NewAnkiNote[];
  updates: { noteId: number; fields: Record<string, string> }[];
}

function fakeAnki(options: {
  models?: string[];
  decks?: string[];
  existing?: Record<string, number>;
  addResult?: (count: number) => (number | null)[];
}): FakeAnki {
  const models = new Set(options.models ?? []);
  const decks = new Set(options.decks ?? []);
  const existing = options.existing ?? {};
  const createdModels: string[] = [];
  const createdDecks: string[] = [];
  const added: NewAnkiNote[] = [];
  const updates: { noteId: number; fields: Record<string, string> }[] = [];
  let nextNoteId = 5000;

  const client: AnkiClient = {
    version: async () => 6,
    modelNames: async () => [...models],
    deckNames: async () => [...decks],
    createModel: async (spec) => {
      models.add(spec.name);
      createdModels.push(spec.name);
      return { id: 1 };
    },
    createDeck: async (deck) => {
      decks.add(deck);
      createdDecks.push(deck);
      return 1;
    },
    findNotes: async (query) => {
      const noteId = existing[query.slice("CardId:".length)];
      return noteId === undefined ? [] : [noteId];
    },
    notesInfo: async () => [],
    addNotes: async (notes) => {
      added.push(...notes);
      if (options.addResult !== undefined) return options.addResult(notes.length);
      return notes.map(() => nextNoteId++);
    },
    updateNoteFields: async (noteId, fields) => {
      updates.push({ noteId, fields });
    },
  };

  return { client, createdModels, createdDecks, added, updates };
}

function fieldsFor(card: SyncCard): Record<string, string> {
  return { CardId: card.id, Front: `front ${card.id}` };
}

describe("syncCards", () => {
  const deck = "Studium::linear-algebra::03-svd";
  const cards: SyncCard[] = [
    { id: "c-8f3a1b2c", type: "basic" },
    { id: "c-91bd07e4", type: "cloze" },
  ];
  const options = { deckFor: () => deck, toFields: fieldsFor };

  it("creates missing note types and decks, then adds and updates notes", async () => {
    const fake = fakeAnki({ existing: { "c-91bd07e4": 7777 } });

    const result = await syncCards(fake.client, cards, options);

    expect(fake.createdModels).toEqual(["Studium Basic", "Studium Cloze"]);
    expect(fake.createdDecks).toEqual([deck]);
    expect(result.added).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.failed).toEqual([]);
    expect(result.ankiIds).toEqual({ "c-8f3a1b2c": 5000, "c-91bd07e4": 7777 });
    expect(fake.added[0]).toMatchObject({
      deckName: deck,
      modelName: modelForType("basic").name,
      fields: fieldsFor(cards[0] as SyncCard),
      options: { allowDuplicate: true },
    });
    expect(fake.updates).toEqual([{ noteId: 7777, fields: fieldsFor(cards[1] as SyncCard) }]);
  });

  it("skips creating note types that already exist", async () => {
    const fake = fakeAnki({
      models: [STUDIUM_BASIC_MODEL.name, STUDIUM_CLOZE_MODEL.name],
      decks: [deck],
    });

    const result = await syncCards(fake.client, cards, options);

    expect(fake.createdModels).toEqual([]);
    expect(fake.createdDecks).toEqual([]);
    expect(result.added).toBe(2);
  });

  it("records a card Anki refuses to add instead of failing the whole sync", async () => {
    const fake = fakeAnki({
      models: [STUDIUM_BASIC_MODEL.name, STUDIUM_CLOZE_MODEL.name],
      addResult: (count) => Array.from({ length: count }, (_value, index) => (index === 0 ? null : 6000 + index)),
    });

    const result = await syncCards(fake.client, cards, options);

    expect(result.added).toBe(1);
    expect(result.failed).toEqual([{ id: "c-8f3a1b2c", error: "AnkiConnect did not add the note" }]);
    expect(result.ankiIds).toEqual({ "c-91bd07e4": 6001 });
  });
});
